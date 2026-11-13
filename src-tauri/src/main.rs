#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, Manager};

const API_HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
const API_PORT: u16 = 8787;
const API_START_TIMEOUT: Duration = Duration::from_secs(45);

struct ApiProcess(Mutex<Option<Child>>);

// Tauri returns Windows resource paths using the extended-length \\?\ prefix.
// Node's Windows CommonJS entry-point realpath path can mis-handle that form
// (notably when the install path contains spaces), truncating the drive path
// to `D:` before the API module is loaded. Convert it back to a normal Win32
// path before passing it to CreateProcess or using it as the child CWD.
#[cfg(target_os = "windows")]
fn process_compatible_path(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

#[cfg(not(target_os = "windows"))]
fn process_compatible_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn startup_log_path<R: tauri::Runtime>(app: &tauri::App<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("WemmbuAssistant"))
        .join("logs")
        .join("desktop-startup.log")
}

fn append_log(path: &PathBuf, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} | {}", chrono_free_timestamp(), message);
        let _ = file.flush();
    }
}

fn chrono_free_timestamp() -> String {
    // A monotonic-friendly timestamp without another crate dependency.
    format!("{:?}", std::time::SystemTime::now())
}

#[cfg(target_os = "windows")]
fn show_startup_error(message: &str) {
    use std::{ffi::OsStr, iter::once, os::windows::ffi::OsStrExt, ptr::null_mut};
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, flags: u32) -> i32;
    }
    let title: Vec<u16> = OsStr::new("Wemmbu AI Assistant — Startup Error").encode_wide().chain(once(0)).collect();
    let body: Vec<u16> = OsStr::new(message).encode_wide().chain(once(0)).collect();
    unsafe { MessageBoxW(null_mut(), body.as_ptr(), title.as_ptr(), 0x10); }
}

#[cfg(not(target_os = "windows"))]
fn show_startup_error(message: &str) {
    eprintln!("Wemmbu AI Assistant startup error: {message}");
}

fn app_root_and_runtime<R: tauri::Runtime>(
    app: &tauri::App<R>,
    log_path: &PathBuf,
) -> Result<(PathBuf, PathBuf, PathBuf), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let server_entry = project_root.join("server").join("index.js");
        append_log(log_path, &format!("Development mode. Project root: {}", project_root.display()));
        return Ok((project_root, PathBuf::from("node"), server_entry));
    }

    let resource_dir = app.path().resource_dir()?;
    append_log(log_path, &format!("Tauri resource directory: {}", resource_dir.display()));

    // Match the resource paths declared in tauri.conf.json first. The alternate
    // layouts are retained for installations produced by older Tauri bundlers.
    let app_candidates = [
        app.path().resolve("resources/app", BaseDirectory::Resource).ok(),
        Some(resource_dir.join("resources").join("app")),
        Some(resource_dir.join("app")),
    ];
    let app_root = app_candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.join("server").join("index.js").is_file())
        .ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Could not locate bundled server/index.js under resource directory {}", resource_dir.display()),
        ))?;

    let runtime_candidates = [
        app.path().resolve("resources/runtime/node.exe", BaseDirectory::Resource).ok(),
        Some(resource_dir.join("resources").join("runtime").join("node.exe")),
        Some(resource_dir.join("runtime").join("node.exe")),
    ];
    let node_program = runtime_candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Could not locate bundled runtime/node.exe under resource directory {}", resource_dir.display()),
        ))?;

    append_log(log_path, &format!("Resolved API root: {}", app_root.display()));
    append_log(log_path, &format!("Resolved Node runtime: {}", node_program.display()));
    let server_entry = app_root.join("server").join("index.js");
    Ok((app_root, node_program, server_entry))
}

fn api_health_check(address: SocketAddrV4) -> bool {
    let socket_address = std::net::SocketAddr::V4(address);
    let Ok(mut stream) = TcpStream::connect_timeout(&socket_address, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream.write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok()
        && response.starts_with("HTTP/1.1 200")
        && response.contains("\"ok\":true")
}

fn start_local_api<R: tauri::Runtime>(
    app: &mut tauri::App<R>,
    log_path: &PathBuf,
) -> Result<Child, Box<dyn std::error::Error>> {
    append_log(log_path, "Starting Wemmbu local API process.");
    let (app_root, node_program, server_entry) = app_root_and_runtime(app, log_path)?;
    if !server_entry.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Wemmbu API entry point is missing: {}", server_entry.display()),
        ).into());
    }
    if cfg!(not(debug_assertions)) && !node_program.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Bundled Node.js runtime is missing: {}", node_program.display()),
        ).into());
    }

    let data_dir = process_compatible_path(&app.path().app_data_dir()?);
    fs::create_dir_all(data_dir.join("memory"))?;

    // Pass a short relative script argument instead of the absolute Tauri
    // resource path. On Windows this avoids exposing `\\?\D:\...` to
    // Node's CLI realpath resolver; `current_dir` anchors the relative path.
    let process_app_root = process_compatible_path(&app_root);
    let process_node_program = process_compatible_path(&node_program);
    let server_argument = PathBuf::from("server").join("index.js");
    let resolved_process_entry = process_app_root.join(&server_argument);
    if !resolved_process_entry.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("API entry point is not present from normalized working directory: {}", resolved_process_entry.display()),
        ).into());
    }

    append_log(log_path, &format!("Data directory: {}", data_dir.display()));
    append_log(log_path, &format!("API entry point (resolved): {}", resolved_process_entry.display()));
    append_log(log_path, &format!("Node working directory: {}", process_app_root.display()));
    append_log(log_path, &format!("Node script argument: {}", server_argument.display()));

    let mut command = Command::new(&process_node_program);
    command
        .arg(&server_argument)
        .current_dir(&process_app_root)
        .env("AQIRON_WEMMBU_API_PORT", API_PORT.to_string())
        .env("AQIRON_WEMMBU_DATA_DIR", &data_dir)
        .env("AQIRON_WEMMBU_MEMORY_DIR", data_dir.join("memory"))
        .stdin(Stdio::piped());

    if cfg!(debug_assertions) {
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        let log_file = OpenOptions::new().create(true).append(true).open(log_path)?;
        command.stdout(Stdio::from(log_file.try_clone()?)).stderr(Stdio::from(log_file));
    }

    #[cfg(target_os = "windows")]
    if !cfg!(debug_assertions) {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    append_log(log_path, &format!("Launching Node executable: {}", process_node_program.display()));
    let mut child = command.spawn().map_err(|error| {
        append_log(log_path, &format!("Node process spawn failed: {error}"));
        error
    })?;
    append_log(log_path, &format!("Node process spawned with PID {}.", child.id()));

    let address = SocketAddrV4::new(API_HOST, API_PORT);
    let deadline = Instant::now() + API_START_TIMEOUT;
    loop {
        if api_health_check(address) {
            append_log(log_path, "Local API health check passed (HTTP 200).");
            return Ok(child);
        }
        if let Some(status) = child.try_wait()? {
            append_log(log_path, &format!("Node process exited before health check: {status}. See preceding Node output in this log."));
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Wemmbu local API exited during startup ({status}). See the startup log for the Node.js error."),
            ).into());
        }
        if Instant::now() >= deadline {
            append_log(log_path, "Local API startup timed out after 45 seconds; terminating child process.");
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Wemmbu local API did not become ready within 45 seconds. See the startup log for details.",
            ).into());
        }
        thread::sleep(Duration::from_millis(150));
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let log_path = startup_log_path(app);
            append_log(&log_path, "========== Wemmbu desktop launch ==========");
            append_log(&log_path, &format!("App version: {}", env!("CARGO_PKG_VERSION")));
            match start_local_api(app, &log_path) {
                Ok(api) => {
                    app.manage(ApiProcess(Mutex::new(Some(api))));
                    append_log(&log_path, "Desktop startup completed; API process is healthy.");
                    Ok(())
                }
                Err(error) => {
                    let message = format!(
                        "Wemmbu AI Assistant could not start its local API and will close.\n\nError: {error}\n\nDiagnostic log:\n{}\n\nPlease send this log file so the startup issue can be identified.",
                        log_path.display()
                    );
                    append_log(&log_path, &format!("FATAL STARTUP ERROR: {error}"));
                    show_startup_error(&message);
                    Err(error)
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Wemmbu Assistant desktop application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<ApiProcess>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        if let Some(mut input) = child.stdin.take() {
                            let _ = writeln!(input, "shutdown");
                        }
                        let grace_deadline = Instant::now() + Duration::from_secs(6);
                        while Instant::now() < grace_deadline {
                            match child.try_wait() {
                                Ok(Some(_)) => break,
                                Ok(None) => thread::sleep(Duration::from_millis(75)),
                                Err(_) => break,
                            }
                        }
                        if matches!(child.try_wait(), Ok(None)) {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        }
    });
}
