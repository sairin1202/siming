import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSameOrigin } from './request.mjs';

const post = (origin, headers = {}) =>
  new Request('http://siming.art/api/guide', { method: 'POST', headers: { origin, ...headers } });

test('the page may call its own origin, and no other', () => {
  assert.doesNotThrow(() => assertSameOrigin(post('http://siming.art')));
  assert.throws(() => assertSameOrigin(post('https://evil.example')), /跨站/);
});

test('behind a trusted proxy, the forwarded scheme counts', () => {
  const behindProxy = post('https://siming.art', { 'x-forwarded-proto': 'https' });
  assert.throws(() => assertSameOrigin(behindProxy), /跨站/, 'untrusted unless configured');
  process.env.VINEXT_TRUST_PROXY = '1';
  try {
    assert.doesNotThrow(() => assertSameOrigin(behindProxy));
    assert.throws(() => assertSameOrigin(post('https://evil.example', { 'x-forwarded-proto': 'https' })), /跨站/);
  } finally {
    delete process.env.VINEXT_TRUST_PROXY;
  }
});
