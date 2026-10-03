import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 用户、登录会话与问事记录，存于本地 SQLite（Node 内置 node:sqlite）。
 * 路径由 SIMING_DB_PATH 指定；生产环境指向 shared/data，跨版本保留。
 */

export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_RECORDS = 200;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS records (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  question TEXT NOT NULL,
  choice TEXT NOT NULL,
  lean TEXT,
  mode TEXT,
  gua TEXT,
  days TEXT NOT NULL DEFAULT '[]',
  outcome TEXT,
  reading TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS records_user_at ON records(user_id, at DESC);
CREATE TABLE IF NOT EXISTS auth_events (
  kind TEXT NOT NULL,
  phone TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_events_phone ON auth_events(kind, phone, at);
CREATE INDEX IF NOT EXISTS auth_events_ip ON auth_events(kind, ip, at);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** 进程内共享的数据库连接。 */
export function getDb() {
  globalThis.__simingDb ??= openDb(resolve(process.env.SIMING_DB_PATH || 'data/siming.db'));
  return globalThis.__simingDb;
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// ---------- 用户与会话 ----------

/** 按手机号登录（不存在则注册），返回新会话令牌。 */
export function createSession(db, phone, now = Date.now()) {
  db.prepare(
    `INSERT INTO users (phone, created_at, last_login_at) VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET last_login_at = excluded.last_login_at`,
  ).run(phone, now, now);
  const user = db.prepare('SELECT id, phone FROM users WHERE phone = ?').get(phone);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_DAYS * DAY_MS;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    user.id,
    now,
    expiresAt,
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return { token, expiresAt, user: { id: Number(user.id), phone: user.phone } };
}

export function userForToken(db, token, now = Date.now()) {
  if (!token || token.length > 100) return null;
  const row = db
    .prepare(
      `SELECT users.id, users.phone FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), now);
  return row ? { id: Number(row.id), phone: row.phone } : null;
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

// ---------- 发送与校验频率 ----------

export const LIMITS = {
  // 每个号码 60 秒一次、每天 10 次；每个 IP 每小时 30 次。
  send: { phoneGapMs: 60_000, phoneDaily: 10, ipHourly: 30 },
  // 每个号码 10 分钟内最多错 5 次。
  verify: { phoneFails: 5, windowMs: 10 * 60_000 },
};

function countSince(db, kind, column, value, since) {
  return Number(
    db.prepare(`SELECT COUNT(*) AS n FROM auth_events WHERE kind = ? AND ${column} = ? AND at > ?`).get(kind, value, since)
      .n,
  );
}

/** 返回不能发送的原因；可以发送时返回 null。 */
export function sendBlockedReason(db, phone, ip, now = Date.now()) {
  if (countSince(db, 'send', 'phone', phone, now - LIMITS.send.phoneGapMs) > 0) return '验证码已发出，请一分钟后再试。';
  if (countSince(db, 'send', 'phone', phone, now - DAY_MS) >= LIMITS.send.phoneDaily) return '今日发送次数已达上限，请明日再试。';
  if (countSince(db, 'send', 'ip', ip, now - 3_600_000) >= LIMITS.send.ipHourly) return '请求太频繁，请稍后再试。';
  return null;
}

export function verifyBlocked(db, phone, now = Date.now()) {
  return countSince(db, 'verify_fail', 'phone', phone, now - LIMITS.verify.windowMs) >= LIMITS.verify.phoneFails;
}

export function logAuthEvent(db, kind, phone, ip, now = Date.now()) {
  db.prepare('INSERT INTO auth_events (kind, phone, ip, at) VALUES (?, ?, ?, ?)').run(kind, phone, ip, now);
  db.prepare('DELETE FROM auth_events WHERE at < ?').run(now - 2 * DAY_MS);
}

export function clearVerifyFails(db, phone) {
  db.prepare("DELETE FROM auth_events WHERE kind = 'verify_fail' AND phone = ?").run(phone);
}

// ---------- 问事记录 ----------

const isString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const oneOf = (value, options) => (options.includes(value) ? value : null);

/** 校验客户端提交的一条记录，无效返回 null。 */
export function sanitizeRecord(input) {
  if (!input || typeof input !== 'object') return null;
  const { id, question, choice, at } = input;
  if (!isString(id, 64) || !/^[\w-]+$/.test(id)) return null;
  if (!isString(question, 500) || !['go', 'stop'].includes(choice)) return null;
  if (!isString(at, 40) || Number.isNaN(Date.parse(at))) return null;
  const days = Array.isArray(input.days)
    ? input.days.filter((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)).slice(0, 5)
    : [];
  return {
    id,
    at: new Date(at).toISOString(),
    question,
    choice,
    lean: oneOf(input.lean, ['go', 'wait', 'stop']),
    mode: oneOf(input.mode, ['gua', 'ming']),
    gua: isString(input.gua, 20) ? input.gua : null,
    days,
    outcome: oneOf(input.outcome, ['good', 'okay', 'bad']),
    reading: isString(input.reading, 2_000) ? input.reading : null,
  };
}

/** 保存记录；同一 id 已存在时保留原记录，只补上结果。 */
export function saveRecords(db, userId, records) {
  const insert = db.prepare(
    `INSERT INTO records (user_id, id, at, question, choice, lean, mode, gua, days, outcome, reading)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET outcome = COALESCE(records.outcome, excluded.outcome)`,
  );
  db.exec('BEGIN');
  try {
    for (const record of records) {
      insert.run(
        userId,
        record.id,
        record.at,
        record.question,
        record.choice,
        record.lean,
        record.mode,
        record.gua,
        JSON.stringify(record.days),
        record.outcome,
        record.reading,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setOutcome(db, userId, id, outcome) {
  const value = oneOf(outcome, ['good', 'okay', 'bad']);
  return db.prepare('UPDATE records SET outcome = ? WHERE user_id = ? AND id = ?').run(value, userId, id).changes > 0;
}

export function listRecords(db, userId) {
  return db
    .prepare(`SELECT * FROM records WHERE user_id = ? ORDER BY at DESC LIMIT ${MAX_RECORDS}`)
    .all(userId)
    .map((row) => {
      const record = { id: row.id, at: row.at, question: row.question, choice: row.choice, lean: row.lean, days: JSON.parse(row.days) };
      for (const key of ['mode', 'gua', 'outcome', 'reading']) if (row[key]) record[key] = row[key];
      return record;
    });
}
