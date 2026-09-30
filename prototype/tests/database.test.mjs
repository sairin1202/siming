import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  beginGeneration,
  finishGeneration,
  openDatabase,
  readHistory,
  saveHistoryUpdate,
  withDatabaseSession,
} from '../lib/database.mjs';
import { parseDecision } from '../lib/persistence.mjs';

const createdOwners = new Set();

async function session(cookie = '') {
  const request = new Request('http://localhost/api/history', {
    headers: { cookie },
  });
  const result = await withDatabaseSession(
    request,
    (_connection, ownerId) => ownerId,
  );
  createdOwners.add(result.value);
  return {
    ownerId: result.value,
    cookie: result.cookie?.split(';')[0] || cookie,
  };
}

function decision() {
  const createdAt = new Date().toISOString();
  return parseDecision({
    id: crypto.randomUUID(),
    title: '数据库持久化集成测试',
    verdict: null,
    createdAt,
    updatedAt: createdAt,
    decidedAt: null,
    turns: [
      {
        id: crypto.randomUUID(),
        userMessage: '可以先试两周吗？',
        createdAt,
        responses: [
          {
            id: crypto.randomUUID(),
            role: 'angel',
            content: '',
            status: 'streaming',
            createdAt,
          },
        ],
      },
    ],
  });
}

async function usingDatabase(action) {
  const connection = await openDatabase();
  try {
    return await action(connection);
  } finally {
    await connection.end();
  }
}

after(async () => {
  // Only remove records belonging to the fresh owners created by these tests.
  await usingDatabase(async (connection) => {
    for (const ownerId of createdOwners) {
      await connection.execute('DELETE FROM owners WHERE id = ?', [ownerId]);
    }
  });
});

test('browser session cookie restores the same owner and is HttpOnly', async () => {
  const first = await session();
  const restored = await session(first.cookie);
  assert.equal(restored.ownerId, first.ownerId);
  const fresh = await withDatabaseSession(
    new Request('https://example.com/api/history'),
    (_connection, ownerId) => ownerId,
  );
  createdOwners.add(fresh.value);
  assert.match(fresh.cookie, /HttpOnly; SameSite=Lax/);
  assert.match(fresh.cookie, /Secure/);
});

test('decisions, ordered turns, replies and verdict survive a database reload', async () => {
  const { ownerId } = await session();
  const item = decision();
  item.turns[0].responses[0] = {
    ...item.turns[0].responses[0],
    status: 'complete',
    content: '可以先明确边界，再进行两周试运行。',
    safetyMode: 'standard',
  };
  item.turns.push({
    id: crypto.randomUUID(),
    userMessage: '那我需要哪些边界？',
    createdAt: item.createdAt,
    responses: [],
  });
  await usingDatabase(async (connection) => {
    await saveHistoryUpdate(connection, ownerId, {
      decision: item,
      currentDecisionId: item.id,
    });
    await saveHistoryUpdate(connection, ownerId, {
      decision: item,
      currentDecisionId: item.id,
    });
    const restored = await readHistory(connection, ownerId);
    assert.equal(restored.decisions.length, 1);
    assert.equal(restored.currentDecisionId, item.id);
    assert.deepEqual(restored.decisions[0], item);
    const settled = parseDecision({
      ...item,
      verdict: 'yes',
      updatedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
    });
    await saveHistoryUpdate(connection, ownerId, {
      decision: settled,
      currentDecisionId: null,
    });
    await saveHistoryUpdate(connection, ownerId, {
      decision: item,
      currentDecisionId: item.id,
    });
    const final = await readHistory(connection, ownerId);
    assert.equal(final.currentDecisionId, null);
    assert.equal(final.decisions[0].winner, 'angel');
    assert.equal(final.decisions[0].verdict, 'yes');
  });
});

test('another browser cannot read, select or overwrite an existing decision', async () => {
  const owner = await session();
  const stranger = await session();
  const item = decision();
  await usingDatabase(async (connection) => {
    await saveHistoryUpdate(connection, owner.ownerId, {
      decision: item,
      currentDecisionId: item.id,
    });
    assert.equal(
      (await readHistory(connection, stranger.ownerId)).decisions.length,
      0,
    );
    await assert.rejects(
      saveHistoryUpdate(connection, stranger.ownerId, {
        decision: item,
        currentDecisionId: null,
      }),
      { status: 404 },
    );
    await assert.rejects(
      saveHistoryUpdate(connection, stranger.ownerId, {
        decision: null,
        currentDecisionId: item.id,
      }),
      { status: 404 },
    );
    assert.equal(
      (await readHistory(connection, owner.ownerId)).decisions[0].title,
      item.title,
    );
  });
});

test('server-generated replies cannot be erased by a stale client snapshot', async () => {
  const { ownerId } = await session();
  const item = decision();
  const replyId = item.turns[0].responses[0].id;
  await usingDatabase(async (connection) => {
    const generation = await beginGeneration(
      connection,
      ownerId,
      item,
      replyId,
      'angel',
    );
    assert.equal(
      await finishGeneration(generation, {
        content: '服务端已保存的完整回复。',
        status: 'complete',
        safetyMode: 'standard',
      }),
      true,
    );
    item.updatedAt = new Date(Date.now() + 1000).toISOString();
    await saveHistoryUpdate(connection, ownerId, {
      decision: item,
      currentDecisionId: item.id,
    });
    const reply = (await readHistory(connection, ownerId)).decisions[0].turns[0]
      .responses[0];
    assert.equal(reply.status, 'complete');
    assert.equal(reply.content, '服务端已保存的完整回复。');
  });
});

test('generation retries reuse reply IDs and reject concurrent generation', async () => {
  const { ownerId } = await session();
  const item = decision();
  const replyId = item.turns[0].responses[0].id;
  await usingDatabase(async (connection) => {
    const first = await beginGeneration(
      connection,
      ownerId,
      item,
      replyId,
      'angel',
    );
    await assert.rejects(
      beginGeneration(connection, ownerId, item, replyId, 'angel'),
      { status: 409, retryable: true },
    );
    await finishGeneration(first, {
      content: '部分输出',
      status: 'error',
      safetyMode: 'standard',
      error: { message: '测试中断', retryable: true },
    });
    const retry = await beginGeneration(
      connection,
      ownerId,
      item,
      replyId,
      'angel',
    );
    assert.notEqual(retry.generationId, first.generationId);
    assert.equal(
      await finishGeneration(first, {
        content: '旧请求迟到的回复',
        status: 'complete',
        safetyMode: 'standard',
      }),
      false,
    );
    await finishGeneration(retry, {
      content: '重试成功',
      status: 'complete',
      safetyMode: 'standard',
    });
    const restored = await readHistory(connection, ownerId);
    assert.equal(restored.decisions[0].turns.length, 1);
    assert.equal(restored.decisions[0].turns[0].responses.length, 1);
    assert.equal(
      restored.decisions[0].turns[0].responses[0].content,
      '重试成功',
    );
  });
});

test('settling during generation persists partial content and rejects late output', async () => {
  const { ownerId } = await session();
  const item = decision();
  const replyId = item.turns[0].responses[0].id;
  await usingDatabase(async (connection) => {
    const generation = await beginGeneration(
      connection,
      ownerId,
      item,
      replyId,
      'angel',
    );
    item.turns[0].responses[0].content = '用户已看到的部分输出';
    const settled = parseDecision({
      ...item,
      verdict: 'no',
      updatedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
    });
    await saveHistoryUpdate(connection, ownerId, {
      decision: settled,
      currentDecisionId: null,
    });
    assert.equal(
      await finishGeneration(generation, {
        content: '迟到的完整回复',
        status: 'complete',
        safetyMode: 'standard',
      }),
      false,
    );
    const restored = (await readHistory(connection, ownerId)).decisions[0];
    assert.equal(restored.verdict, 'no');
    assert.equal(
      restored.turns[0].responses[0].content,
      '用户已看到的部分输出',
    );
    assert.equal(restored.turns[0].responses[0].status, 'error');
    await assert.rejects(
      beginGeneration(connection, ownerId, item, replyId, 'angel'),
      { status: 409 },
    );
  });
});

test('invalid turn updates roll back the whole transaction', async () => {
  const { ownerId } = await session();
  const item = decision();
  await usingDatabase(async (connection) => {
    await saveHistoryUpdate(connection, ownerId, {
      decision: item,
      currentDecisionId: item.id,
    });
    const changed = structuredClone(item);
    changed.title = '不应写入的标题';
    changed.turns[0].userMessage = '不应覆盖原问题';
    await assert.rejects(
      saveHistoryUpdate(connection, ownerId, {
        decision: changed,
        currentDecisionId: null,
      }),
      { status: 409 },
    );
    assert.equal(
      (await readHistory(connection, ownerId)).decisions[0].title,
      item.title,
    );
  });
});

test('new turns are saved even if the browser clock is behind the database', async () => {
  const { ownerId } = await session();
  const item = decision();
  await usingDatabase(async (connection) => {
    const first = await beginGeneration(
      connection,
      ownerId,
      item,
      item.turns[0].responses[0].id,
      'angel',
    );
    await finishGeneration(first, {
      content: '第一轮完整回复',
      status: 'complete',
      safetyMode: 'standard',
    });
    const next = structuredClone(item);
    next.turns.push({
      id: crypto.randomUUID(),
      userMessage: '补充下一轮信息',
      createdAt: item.createdAt,
      responses: [
        {
          id: crypto.randomUUID(),
          role: 'devil',
          content: '',
          status: 'streaming',
          createdAt: item.createdAt,
        },
      ],
    });
    const second = await beginGeneration(
      connection,
      ownerId,
      next,
      next.turns[1].responses[0].id,
      'devil',
    );
    assert.equal(second.decision.turns.length, 2);
    assert.equal(
      second.decision.turns[0].responses[0].content,
      '第一轮完整回复',
    );
    await finishGeneration(second, {
      content: '第二轮完整回复',
      status: 'complete',
      safetyMode: 'standard',
    });
  });
});

test('a stale browser cannot generate a reply in an earlier turn', async () => {
  const { ownerId } = await session();
  const item = decision();
  await usingDatabase(async (connection) => {
    const updated = structuredClone(item);
    updated.turns.push({
      id: crypto.randomUUID(),
      userMessage: '另一页已开启新一轮',
      createdAt: item.createdAt,
      responses: [
        {
          id: crypto.randomUUID(),
          role: 'devil',
          content: '已保存的新回复',
          status: 'complete',
          createdAt: item.createdAt,
        },
      ],
    });
    await saveHistoryUpdate(connection, ownerId, {
      decision: updated,
      currentDecisionId: updated.id,
    });
    await assert.rejects(
      beginGeneration(
        connection,
        ownerId,
        item,
        item.turns[0].responses[0].id,
        'angel',
      ),
      { status: 409 },
    );
  });
});
