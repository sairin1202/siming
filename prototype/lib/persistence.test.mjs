import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSameOrigin,
  parseDecision,
  readJsonBody,
} from './persistence.mjs';

function item() {
  return {
    id: 'decision-1',
    title: '要不要试试？',
    verdict: null,
    createdAt: '2026-09-30T08:00:00.000Z',
    updatedAt: '2026-09-30T08:00:00.000Z',
    turns: [
      {
        id: 'turn-1',
        userMessage: '要不要试试？',
        createdAt: '2026-09-30T08:00:00.000Z',
        responses: [],
      },
    ],
  };
}

test('persistence rejects duplicate IDs, invalid roles and oversized content', () => {
  const duplicate = item();
  duplicate.turns[0].id = duplicate.id;
  assert.throws(() => parseDecision(duplicate), { status: 400 });
  const invalid = item();
  invalid.turns[0].responses.push({
    id: 'reply-1',
    role: 'system',
    content: '',
    status: 'streaming',
    createdAt: invalid.createdAt,
  });
  assert.throws(() => parseDecision(invalid), { status: 400 });
  invalid.turns[0].responses[0].role = 'angel';
  invalid.turns[0].responses[0].content = 'x'.repeat(4001);
  assert.throws(() => parseDecision(invalid), { status: 400 });
});

test('winner and status are derived from verdict, ignoring client claims', () => {
  const parsed = parseDecision({
    ...item(),
    verdict: 'yes',
    decidedAt: item().updatedAt,
    winner: 'devil',
    status: 'active',
  });
  assert.equal(parsed.winner, 'angel');
  assert.equal(parsed.status, 'decided');
});

test('cross-site requests are rejected', () => {
  assert.throws(
    () =>
      assertSameOrigin(
        new Request('https://app.example/api/history', {
          headers: { origin: 'https://other.example' },
        }),
      ),
    { status: 403 },
  );
  assert.throws(
    () =>
      assertSameOrigin(
        new Request('https://app.example/api/history', {
          headers: { 'sec-fetch-site': 'cross-site' },
        }),
      ),
    { status: 403 },
  );
});

test('JSON byte limit applies without Content-Length', async () => {
  const request = new Request('https://app.example/api/history', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '中文中文' }),
  });
  await assert.rejects(readJsonBody(request, 20), { status: 413 });
});
