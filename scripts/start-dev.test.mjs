import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedNodeVersion, resolveApiStartupPlan } from './start-dev.mjs';

test('Node.js version check accepts 24.15.0 and newer', () => {
  assert.equal(isSupportedNodeVersion('24.15.0'), true);
  assert.equal(isSupportedNodeVersion('24.15.1'), true);
  assert.equal(isSupportedNodeVersion('25.0.0'), true);
  assert.equal(isSupportedNodeVersion('24.14.9'), false);
  assert.equal(isSupportedNodeVersion('23.99.0'), false);
  assert.equal(isSupportedNodeVersion('not-a-version'), false);
});

test('startup plan reuses a healthy existing Wemmbu API', async () => {
  const plan = await resolveApiStartupPlan({
    preferredPort: 8787,
    healthCheck: async () => true,
    portAvailable: async () => false,
  });
  assert.deepEqual(plan, { port: 8787, reuseExistingApi: true });
});

test('startup plan uses the default port when it is free', async () => {
  const plan = await resolveApiStartupPlan({
    preferredPort: 8787,
    healthCheck: async () => false,
    portAvailable: async () => true,
  });
  assert.deepEqual(plan, { port: 8787, reuseExistingApi: false });
});

test('startup plan selects a free fallback when another app owns the default port', async () => {
  const plan = await resolveApiStartupPlan({
    preferredPort: 8787,
    fallbackStart: 8788,
    fallbackEnd: 8790,
    healthCheck: async () => false,
    portAvailable: async (port) => port === 8789,
  });
  assert.deepEqual(plan, { port: 8789, reuseExistingApi: false });
});

test('startup plan fails clearly when every supported port is occupied', async () => {
  await assert.rejects(
    resolveApiStartupPlan({
      preferredPort: 8787,
      fallbackStart: 8788,
      fallbackEnd: 8789,
      healthCheck: async () => false,
      portAvailable: async () => false,
    }),
    /no free fallback port/i,
  );
});

test('startup plan rejects an invalid preferred port', async () => {
  await assert.rejects(
    resolveApiStartupPlan({ preferredPort: 70000 }),
    /Invalid API port/,
  );
});
