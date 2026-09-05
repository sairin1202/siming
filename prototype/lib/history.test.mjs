import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HISTORY_STORAGE_KEY,
  loadDecisionHistory,
  saveDecisionHistory,
  summarizeDecisionHistory,
  upsertDecisionHistory,
} from './history.mjs';

function decision(overrides = {}) {
  return {
    id: 'decision-1',
    title: '要不要接这个项目？',
    status: 'active',
    verdict: null,
    winner: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
    decidedAt: null,
    turns: [
      {
        id: 'turn-1',
        userMessage: '机会很好，但我最近很累。',
        createdAt: '2026-09-04T08:00:00.000Z',
        responses: [],
      },
    ],
    ...overrides,
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('loadDecisionHistory fails open for missing or malformed data', () => {
  assert.deepEqual(loadDecisionHistory(memoryStorage()), {
    decisions: [],
    currentDecisionId: null,
  });
  assert.deepEqual(
    loadDecisionHistory(memoryStorage({ [HISTORY_STORAGE_KEY]: '{broken' })),
    { decisions: [], currentDecisionId: null },
  );
});

test('loadDecisionHistory restores an active decision and converts interrupted replies to retryable errors', () => {
  const storedDecision = decision({
    turns: [
      {
        id: 'turn-1',
        userMessage: '机会很好，但我最近很累。',
        createdAt: '2026-09-04T08:00:00.000Z',
        responses: [
          {
            id: 'reply-1',
            role: 'angel',
            content: '可以先试两周',
            status: 'streaming',
            createdAt: '2026-09-04T08:01:00.000Z',
          },
        ],
      },
    ],
  });
  const storage = memoryStorage({
    [HISTORY_STORAGE_KEY]: JSON.stringify({
      version: 1,
      currentDecisionId: storedDecision.id,
      decisions: [storedDecision],
    }),
  });

  const snapshot = loadDecisionHistory(storage);

  assert.equal(snapshot.currentDecisionId, storedDecision.id);
  assert.equal(snapshot.decisions[0].turns[0].responses[0].status, 'error');
  assert.equal(
    snapshot.decisions[0].turns[0].responses[0].error.retryable,
    true,
  );
});

test('upsertDecisionHistory keeps the latest version first without duplicates', () => {
  const older = decision();
  const newer = decision({
    title: '更新后的标题',
    updatedAt: '2026-09-04T09:00:00.000Z',
  });

  const result = upsertDecisionHistory([older], newer);

  assert.equal(result.length, 1);
  assert.equal(result[0].title, '更新后的标题');
});

test('summarizeDecisionHistory derives wins only from settled decisions', () => {
  const decisions = [
    decision({ id: 'active' }),
    decision({ id: 'yes', verdict: 'yes' }),
    decision({ id: 'no-1', verdict: 'no' }),
    decision({ id: 'no-2', verdict: 'no' }),
  ];

  assert.deepEqual(summarizeDecisionHistory(decisions), {
    total: 4,
    decided: 3,
    active: 1,
    angelWins: 1,
    devilWins: 2,
    angelWinRate: 33,
    devilWinRate: 67,
  });
});

test('saveDecisionHistory writes a versioned snapshot and reports storage failures', () => {
  const storage = memoryStorage();
  assert.equal(
    saveDecisionHistory(storage, {
      decisions: [decision()],
      currentDecisionId: 'decision-1',
    }),
    true,
  );

  const saved = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY));
  assert.equal(saved.version, 1);
  assert.equal(saved.currentDecisionId, 'decision-1');
  assert.equal(saved.decisions[0].id, 'decision-1');

  const throwingStorage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(
    saveDecisionHistory(throwingStorage, {
      decisions: [],
      currentDecisionId: null,
    }),
    false,
  );
});
