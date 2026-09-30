import { createConnection } from 'mysql2/promise';
import { PersistenceError } from './persistence.mjs';
import { parseAgentRequest } from './agent.mjs';

export const MAX_GENERATION_MS = 120000;
const SESSION_COOKIE = 'angel_devil_session';
const SESSION_SECONDS = 365 * 24 * 60 * 60;

export function databaseConfig(env = process.env) {
  for (const key of [
    'MYSQL_HOST',
    'MYSQL_DATABASE',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
  ]) {
    if (
      typeof env[key] !== 'string' ||
      (key !== 'MYSQL_PASSWORD' && !env[key].trim())
    ) {
      throw new PersistenceError(503, '数据库尚未配置。', true);
    }
  }
  const port = Number(env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PersistenceError(503, '数据库端口配置无效。');
  }
  return {
    host: env.MYSQL_HOST,
    port,
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    connectTimeout: 10000,
    disableEval: true,
  };
}

export async function openDatabase() {
  // Workers cannot share live TCP connections between requests.
  return createConnection(databaseConfig());
}

async function transaction(connection, action) {
  await connection.beginTransaction();
  try {
    const result = await action();
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function iso(value) {
  return value ? new Date(`${value.replace(' ', 'T')}Z`).toISOString() : null;
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function browserSession(connection, request) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    const [sessions] = await connection.execute(
      'SELECT owner_id FROM browser_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(6)',
      [await tokenHash(token)],
    );
    if (sessions.length) return { ownerId: sessions[0].owner_id, cookie: null };
  }
  const newToken = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const ownerId = crypto.randomUUID();
  await transaction(connection, async () => {
    await connection.execute(
      'INSERT INTO owners (id, created_at) VALUES (?, UTC_TIMESTAMP(6))',
      [ownerId],
    );
    await connection.execute(
      'INSERT INTO browser_sessions (token_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))',
      [
        await tokenHash(newToken),
        ownerId,
        new Date(Date.now() + SESSION_SECONDS * 1000),
      ],
    );
  });
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return {
    ownerId,
    cookie: `${SESSION_COOKIE}=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`,
  };
}

/**
 * @template T
 * @param {Request} request
 * @param {(connection: import('mysql2/promise').Connection, ownerId: string) => Promise<T> | T} action
 */
export async function withDatabaseSession(request, action) {
  const connection = await openDatabase();
  try {
    const session = await browserSession(connection, request);
    return {
      value: await action(connection, session.ownerId),
      cookie: session.cookie,
    };
  } finally {
    await connection.end();
  }
}

async function lockOwner(connection, ownerId) {
  await connection.execute('SELECT id FROM owners WHERE id = ? FOR UPDATE', [
    ownerId,
  ]);
}

async function writeDecision(connection, ownerId, decision) {
  const [existing] = await connection.execute(
    'SELECT * FROM decisions WHERE id = ? FOR UPDATE',
    [decision.id],
  );
  const stored = existing[0];
  if (stored && stored.owner_id !== ownerId)
    throw new PersistenceError(404, '找不到这局决策。');
  // A settled decision is immutable. Old browser snapshots cannot reopen it.
  if (stored?.verdict) return;
  const stale =
    stored &&
    Date.parse(iso(stored.updated_at)) > Date.parse(decision.updatedAt);
  if (!stored) {
    await connection.execute(
      'INSERT INTO decisions (id, owner_id, title, verdict, created_at, updated_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        decision.id,
        ownerId,
        decision.title,
        decision.verdict,
        new Date(decision.createdAt),
        new Date(decision.updatedAt),
        decision.decidedAt ? new Date(decision.decidedAt) : null,
      ],
    );
  } else {
    await connection.execute(
      'UPDATE decisions SET title = ?, verdict = ?, updated_at = GREATEST(updated_at, ?), decided_at = ? WHERE id = ?',
      [
        stale ? stored.title : decision.title,
        decision.verdict,
        new Date(decision.updatedAt),
        decision.decidedAt ? new Date(decision.decidedAt) : null,
        decision.id,
      ],
    );
  }

  const [storedTurns] = await connection.execute(
    'SELECT * FROM turns WHERE decision_id = ?',
    [decision.id],
  );
  const [storedReplies] = await connection.execute(
    'SELECT r.* FROM replies r JOIN turns t ON r.turn_id = t.id WHERE t.decision_id = ?',
    [decision.id],
  );
  const turnsById = new Map(storedTurns.map((row) => [row.id, row]));
  const repliesById = new Map(storedReplies.map((row) => [row.id, row]));
  for (const [position, turn] of decision.turns.entries()) {
    const previousTurn = turnsById.get(turn.id);
    if (previousTurn) {
      if (
        previousTurn.position !== position ||
        previousTurn.user_message !== turn.userMessage
      ) {
        throw new PersistenceError(
          409,
          '已保存的轮次不能被替换，请刷新后重试。',
        );
      }
    } else {
      await connection.execute(
        'INSERT INTO turns (id, decision_id, position, user_message, created_at) VALUES (?, ?, ?, ?, ?)',
        [
          turn.id,
          decision.id,
          position,
          turn.userMessage,
          new Date(turn.createdAt),
        ],
      );
    }
    for (const [replyPosition, reply] of turn.responses.entries()) {
      const previous = repliesById.get(reply.id);
      if (
        previous &&
        (previous.turn_id !== turn.id ||
          previous.position !== replyPosition ||
          previous.role !== reply.role)
      ) {
        throw new PersistenceError(
          409,
          '已保存的回复不能被替换，请刷新后重试。',
        );
      }
      // Replies generated by the server are authoritative. Client snapshots
      // must not overwrite a completed reply or a generation in progress.
      if (
        previous?.generation_id &&
        !(decision.verdict && previous.status === 'streaming')
      )
        continue;
      // Still append new user messages when the client clock is behind the
      // database clock, but do not replace existing replies with stale data.
      if (previous && stale && !decision.verdict) continue;
      const interrupted = decision.verdict && reply.status === 'streaming';
      const status = interrupted ? 'error' : reply.status;
      const errorMessage = interrupted
        ? '本局已结束，回复已停止。'
        : reply.error?.message || null;
      const values = [
        reply.content,
        status,
        reply.safetyMode || null,
        errorMessage,
        reply.error?.retryable ? 1 : 0,
      ];
      if (previous) {
        await connection.execute(
          'UPDATE replies SET content = ?, status = ?, safety_mode = ?, error_message = ?, retryable = ?, generation_id = NULL, started_at = NULL WHERE id = ?',
          [...values, reply.id],
        );
      } else {
        await connection.execute(
          'INSERT INTO replies (id, turn_id, position, role, content, status, safety_mode, error_message, retryable, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            reply.id,
            turn.id,
            replyPosition,
            reply.role,
            ...values,
            new Date(reply.createdAt),
          ],
        );
      }
    }
  }
  if (decision.verdict) {
    await connection.execute(
      "UPDATE replies r JOIN turns t ON r.turn_id = t.id SET r.status = 'error', r.error_message = '本局已结束，回复已停止。', r.retryable = 0, r.generation_id = NULL, r.started_at = NULL WHERE t.decision_id = ? AND r.status = 'streaming'",
      [decision.id],
    );
  }
}

async function selectCurrentDecision(connection, ownerId, decisionId) {
  if (decisionId) {
    const [rows] = await connection.execute(
      'SELECT verdict FROM decisions WHERE id = ? AND owner_id = ?',
      [decisionId, ownerId],
    );
    if (!rows.length) throw new PersistenceError(404, '找不到这局决策。');
    if (rows[0].verdict) decisionId = null;
  }
  await connection.execute(
    'UPDATE owners SET current_decision_id = ? WHERE id = ?',
    [decisionId, ownerId],
  );
}

export async function saveHistoryUpdate(connection, ownerId, update) {
  await transaction(connection, async () => {
    await lockOwner(connection, ownerId);
    if (update.decision)
      await writeDecision(connection, ownerId, update.decision);
    await selectCurrentDecision(connection, ownerId, update.currentDecisionId);
  });
}

async function historySnapshot(connection, ownerId, recoverInterrupted) {
  const [owners] = await connection.execute(
    'SELECT current_decision_id FROM owners WHERE id = ?',
    [ownerId],
  );
  const [rows] = await connection.execute(
    'SELECT * FROM decisions WHERE owner_id = ? ORDER BY updated_at DESC, id',
    [ownerId],
  );
  const [turnRows] = await connection.execute(
    'SELECT t.* FROM turns t JOIN decisions d ON t.decision_id = d.id WHERE d.owner_id = ? ORDER BY t.position',
    [ownerId],
  );
  const [replyRows] = await connection.execute(
    'SELECT r.* FROM replies r JOIN turns t ON r.turn_id = t.id JOIN decisions d ON t.decision_id = d.id WHERE d.owner_id = ? ORDER BY r.position',
    [ownerId],
  );
  const decisions = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.verdict ? 'decided' : 'active',
    verdict: row.verdict,
    winner:
      row.verdict === 'yes' ? 'angel' : row.verdict === 'no' ? 'devil' : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    decidedAt: iso(row.decided_at),
    turns: [],
  }));
  const decisionsById = new Map(decisions.map((row) => [row.id, row]));
  const turnsById = new Map();
  for (const row of turnRows) {
    const turn = {
      id: row.id,
      userMessage: row.user_message,
      createdAt: iso(row.created_at),
      responses: [],
    };
    decisionsById.get(row.decision_id).turns.push(turn);
    turnsById.set(row.id, turn);
  }
  for (const row of replyRows) {
    const interrupted = recoverInterrupted && row.status === 'streaming';
    const status = interrupted ? 'error' : row.status;
    turnsById.get(row.turn_id).responses.push({
      id: row.id,
      role: row.role,
      content: row.content,
      status,
      createdAt: iso(row.created_at),
      ...(row.safety_mode ? { safetyMode: row.safety_mode } : {}),
      ...(status === 'error'
        ? {
            error: {
              message: interrupted
                ? '上次回复尚未完成，可以重试。'
                : row.error_message || '这次回复中断了。',
              retryable: interrupted || Boolean(row.retryable),
            },
          }
        : {}),
    });
  }
  const currentId = owners[0]?.current_decision_id;
  return {
    decisions,
    currentDecisionId:
      decisions.find(
        (decision) => decision.id === currentId && !decision.verdict,
      )?.id || null,
  };
}

export async function readHistory(
  connection,
  ownerId,
  recoverInterrupted = true,
) {
  // One consistent snapshot avoids reading a verdict from before a commit and
  // its replies from after it.
  return transaction(connection, () =>
    historySnapshot(connection, ownerId, recoverInterrupted),
  );
}

export async function beginGeneration(
  connection,
  ownerId,
  decision,
  replyId,
  role,
) {
  const generationId = crypto.randomUUID();
  const storedDecision = await transaction(connection, async () => {
    await lockOwner(connection, ownerId);
    await writeDecision(connection, ownerId, decision);
    const [decisions] = await connection.execute(
      'SELECT verdict FROM decisions WHERE id = ? AND owner_id = ?',
      [decision.id, ownerId],
    );
    if (!decisions.length) throw new PersistenceError(404, '找不到这局决策。');
    if (decisions[0].verdict)
      throw new PersistenceError(409, '这局决策已经结束。');
    const [busy] = await connection.execute(
      "SELECT r.id FROM replies r JOIN turns t ON r.turn_id = t.id WHERE t.decision_id = ? AND r.status = 'streaming' AND r.generation_id IS NOT NULL AND r.started_at > ?",
      [decision.id, new Date(Date.now() - MAX_GENERATION_MS)],
    );
    if (busy.length)
      throw new PersistenceError(
        409,
        '这一局还有回复正在生成，请稍后重试。',
        true,
      );
    const [replies] = await connection.execute(
      'SELECT r.* FROM replies r JOIN turns t ON r.turn_id = t.id WHERE t.decision_id = ? AND t.position = (SELECT MAX(position) FROM turns WHERE decision_id = ?) ORDER BY r.position DESC LIMIT 1',
      [decision.id, decision.id],
    );
    if (
      !replies.length ||
      replies[0].id !== replyId ||
      replies[0].role !== role
    )
      throw new PersistenceError(409, '对话已更新，请刷新后重试。');
    if (replies[0].status === 'complete')
      throw new PersistenceError(409, '这条回复已经生成完成，请刷新查看。');
    await connection.execute(
      "UPDATE replies SET content = '', status = 'streaming', safety_mode = NULL, error_message = NULL, retryable = 0, generation_id = ?, started_at = UTC_TIMESTAMP(6) WHERE id = ?",
      [generationId, replyId],
    );
    await connection.execute(
      'UPDATE decisions SET updated_at = GREATEST(updated_at, UTC_TIMESTAMP(6)) WHERE id = ?',
      [decision.id],
    );
    await selectCurrentDecision(connection, ownerId, decision.id);
    const snapshot = await historySnapshot(connection, ownerId, false);
    const current = snapshot.decisions.find((item) => item.id === decision.id);
    // Validate the authoritative context before committing the generation.
    parseAgentRequest({
      role,
      decisionTitle: current.title,
      turns: current.turns,
    });
    return current;
  });
  return {
    ownerId,
    decisionId: decision.id,
    replyId,
    generationId,
    decision: storedDecision,
  };
}

export async function finishGeneration(generation, result) {
  const connection = await openDatabase();
  try {
    return await transaction(connection, async () => {
      await lockOwner(connection, generation.ownerId);
      const [decisions] = await connection.execute(
        'SELECT verdict FROM decisions WHERE id = ? AND owner_id = ?',
        [generation.decisionId, generation.ownerId],
      );
      if (!decisions.length || decisions[0].verdict) return false;
      const [updated] = await connection.execute(
        'UPDATE replies SET content = ?, status = ?, safety_mode = ?, error_message = ?, retryable = ? WHERE id = ? AND generation_id = ?',
        [
          result.content,
          result.status,
          result.safetyMode,
          result.error?.message || null,
          result.error?.retryable ? 1 : 0,
          generation.replyId,
          generation.generationId,
        ],
      );
      if (!updated.affectedRows) return false;
      await connection.execute(
        'UPDATE decisions SET updated_at = GREATEST(updated_at, UTC_TIMESTAMP(6)) WHERE id = ?',
        [generation.decisionId],
      );
      return true;
    });
  } finally {
    await connection.end();
  }
}
