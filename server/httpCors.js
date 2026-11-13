export const LOCAL_CORS_METHODS = Object.freeze([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'
]);

export function isAllowedLocalOrigin(origin) {
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  const loopback = parsed.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  const tauri = (parsed.protocol === 'http:' && parsed.hostname === 'tauri.localhost')
    || (parsed.protocol === 'tauri:' && parsed.hostname === 'localhost');
  return Boolean(loopback || tauri);
}

export function isAllowedCorsMethod(method) {
  return LOCAL_CORS_METHODS.includes(String(method || '').toUpperCase());
}

export function applyLocalCorsHeaders(response, origin, requestHeaders = {}) {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', LOCAL_CORS_METHODS.join(', '));
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  // Some WebView2 builds issue a Private Network Access preflight when a
  // Tauri localhost page calls the loopback Node service. Only acknowledge it
  // for the already allow-listed local origins above.
  if (String(requestHeaders['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}
