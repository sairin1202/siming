import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../lib/database.mjs';

test('HTTP streaming reply, history reload and settlement are persisted in MySQL', async () => {
  const base = process.env.TEST_APP_URL || 'http://localhost:3000';
  const connection = await openDatabase();
  let cookie = '';
  let ownerId;
  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: { cookie, ...options.headers },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  }
  try {
    const initial = await request('/api/history');
    assert.equal(initial.status, 200);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(cookie.split('=')[1]),
    );
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const [sessions] = await connection.execute(
      'SELECT owner_id FROM browser_sessions WHERE token_hash = ?',
      [hash],
    );
    ownerId = sessions[0].owner_id;
    const time = new Date().toISOString();
    const replyId = crypto.randomUUID();
    const decision = {
      id: crypto.randomUUID(),
      title: '接口持久化验证',
      verdict: null,
      createdAt: time,
      updatedAt: time,
      decidedAt: null,
      // The crisis branch gives a deterministic stream without billing a model.
      turns: [
        {
          id: crypto.randomUUID(),
          userMessage: '我现在不想活了',
          createdAt: time,
          responses: [
            {
              id: replyId,
              role: 'angel',
              content: '',
              status: 'streaming',
              createdAt: time,
            },
          ],
        },
      ],
    };
    const generated = await request('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'angel', decision, replyId }),
    });
    assert.equal(generated.status, 200);
    const events = await generated.text();
    assert.match(events, /"type":"done"/);
    assert.match(events, /"safetyMode":"crisis"/);
    const saved = await (await request('/api/history')).json();
    assert.equal(saved.decisions.length, 1);
    const reply = saved.decisions[0].turns[0].responses[0];
    assert.equal(reply.status, 'complete');
    assert.ok(reply.content.length > 0);
    assert.equal(reply.id, replyId);
    const settled = {
      ...saved.decisions[0],
      verdict: 'yes',
      decidedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const update = await request('/api/history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: base },
      body: JSON.stringify({ decision: settled, currentDecisionId: null }),
    });
    assert.equal(update.status, 200);
    const restored = await (await request('/api/history')).json();
    assert.equal(restored.decisions[0].winner, 'angel');
    assert.equal(restored.currentDecisionId, null);
    const crossSite = await request('/api/history', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://other.example',
      },
      body: '{}',
    });
    assert.equal(crossSite.status, 403);
    const [rows] = await connection.execute(
      'SELECT r.content, r.status FROM replies r JOIN turns t ON r.turn_id = t.id JOIN decisions d ON t.decision_id = d.id WHERE d.owner_id = ?',
      [ownerId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content, reply.content);
    assert.equal(rows[0].status, 'complete');
  } finally {
    if (ownerId)
      await connection.execute('DELETE FROM owners WHERE id = ?', [ownerId]);
    await connection.end();
  }
});
