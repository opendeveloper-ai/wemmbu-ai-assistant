import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalCorsHeaders, isAllowedCorsMethod, isAllowedLocalOrigin, LOCAL_CORS_METHODS } from './httpCors.js';

test('only Tauri and loopback browser origins are accepted', () => {
  assert.equal(isAllowedLocalOrigin('http://tauri.localhost'), true);
  assert.equal(isAllowedLocalOrigin('tauri://localhost'), true);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:1420'), true);
  assert.equal(isAllowedLocalOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedLocalOrigin('https://untrusted.example'), false);
  assert.equal(isAllowedLocalOrigin('null'), false);
});

test('CORS explicitly permits PUT for settings saves and key changes', () => {
  assert.equal(isAllowedCorsMethod('PUT'), true);
  assert.ok(LOCAL_CORS_METHODS.includes('PUT'));
});

test('preflight advertises PUT and JSON content type', () => {
  const headers = new Map();
  const response = { setHeader: (name, value) => headers.set(name.toLowerCase(), value) };
  applyLocalCorsHeaders(response, 'http://tauri.localhost', { 'access-control-request-method': 'PUT' });
  assert.equal(headers.get('access-control-allow-origin'), 'http://tauri.localhost');
  assert.match(headers.get('access-control-allow-methods'), /\bPUT\b/);
  assert.equal(headers.get('access-control-allow-headers'), 'Content-Type');
});

test('private-network access is acknowledged only when requested', () => {
  const headers = new Map();
  const response = { setHeader: (name, value) => headers.set(name.toLowerCase(), value) };
  applyLocalCorsHeaders(response, 'http://tauri.localhost', { 'access-control-request-private-network': 'true' });
  assert.equal(headers.get('access-control-allow-private-network'), 'true');
});
