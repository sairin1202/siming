import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDatabaseHistory } from './history-client.mjs';
import { saveDecisionHistory } from './history.mjs';

function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key),
    setItem: (key, value) => map.set(key, value),
  };
}

test('legacy browser history is imported once, after establishing the session', async () => {
  const local = storage();
  const item = {
    id: 'decision-1',
    title: '测试迁移',
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    turns: [{ id: 'turn-1', userMessage: '测试迁移', responses: [] }],
  };
  saveDecisionHistory(local, { decisions: [item], currentDecisionId: item.id });
  const remote = { decisions: [], currentDecisionId: null };
  const calls = [];
  const fetcher = async (_url, options) => {
    calls.push(options?.method || 'GET');
    if (options?.method === 'PUT') {
      const update = JSON.parse(options.body);
      if (update.decision) remote.decisions.push(update.decision);
      remote.currentDecisionId = update.currentDecisionId;
      return Response.json({ saved: true });
    }
    return Response.json(remote);
  };
  assert.equal(
    (await loadDatabaseHistory(local, fetcher)).currentDecisionId,
    item.id,
  );
  assert.deepEqual(calls, ['GET', 'PUT', 'PUT', 'GET']);
  calls.length = 0;
  await loadDatabaseHistory(local, fetcher);
  assert.deepEqual(calls, ['GET']);
});

test('failed database reads reject without erasing browser history', async () => {
  const local = storage();
  saveDecisionHistory(local, { decisions: [], currentDecisionId: null });
  const before = local.getItem('angel-devil:decision-history');
  await assert.rejects(
    loadDatabaseHistory(local, async () =>
      Response.json({ error: '数据库不可用' }, { status: 503 }),
    ),
    /数据库不可用/,
  );
  assert.equal(local.getItem('angel-devil:decision-history'), before);
});
