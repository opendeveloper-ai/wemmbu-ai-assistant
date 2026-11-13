const DESKTOP_API_ORIGIN = 'http://127.0.0.1:8787';

function isTauriWebView() {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost';
}

export function apiUrl(path) {
  const normalizedPath = String(path || '');
  if (!normalizedPath.startsWith('/api/')) {
    throw new TypeError(`Expected a local API path, received: ${normalizedPath}`);
  }
  return isTauriWebView() ? `${DESKTOP_API_ORIGIN}${normalizedPath}` : normalizedPath;
}
