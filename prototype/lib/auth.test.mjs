import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clientIp, maskEmail, normalizeEmail, readCookie } from './auth.mjs';
import {
  LIMITS,
  clearLoginFails,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  listRecords,
  logAuthEvent,
  loginBlocked,
  openDb,
  registerBlocked,
  sanitizeRecord,
  saveRecords,
  setOutcome,
  userForToken,
} from './db.mjs';
import { checkPassword, hashPassword, verifyPassword } from './password.mjs';

/** A user and a session, for tests that need someone signed in. */
function signedIn(db, email, now = Date.now()) {
  return createSession(db, createUser(db, email, 'scrypt$x', now), now);
}

test('邮箱与验证码格式', () => {
  assert.equal(normalizeEmail('  Foo.Bar+x@QQ.com '), 'foo.bar+x@qq.com');
  assert.throws(() => normalizeEmail('foo@'), { status: 400 });
  assert.throws(() => normalizeEmail('foo@bar'), { status: 400 });
  assert.throws(() => normalizeEmail('a b@qq.com'), { status: 400 });
  assert.throws(() => normalizeEmail(`${'a'.repeat(250)}@qq.com`), { status: 400 });
  assert.throws(() => normalizeEmail(42), { status: 400 });
  assert.equal(maskEmail('sairin@gmail.com'), 'sa***@gmail.com');
  assert.equal(maskEmail('ab@qq.com'), 'a***@qq.com');
});

test('读取 cookie 与客户端 IP', () => {
  const request = new Request('http://localhost/', {
    headers: { cookie: 'a=1; siming_sid=abc%3D; b=2', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
  });
  assert.equal(readCookie(request, 'siming_sid'), 'abc=');
  assert.equal(readCookie(request, 'missing'), null);
  process.env.VINEXT_TRUST_PROXY = '1';
  assert.equal(clientIp(request), '2.2.2.2');
  delete process.env.VINEXT_TRUST_PROXY;
  assert.equal(clientIp(request), 'unknown');
});

test('密码：加盐哈希、校验与长度', async () => {
  const stored = await hashPassword('correct horse');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(stored, await hashPassword('correct horse'));
  assert.equal(await verifyPassword('correct horse', stored), true);
  assert.equal(await verifyPassword('correct hors', stored), false);
  // No account: still answers no, after the same work.
  assert.equal(await verifyPassword('placeholder-password', undefined), false);
  assert.equal(await verifyPassword('x', 'md5$abc'), false);
  assert.throws(() => checkPassword('short'), { status: 400 });
  assert.throws(() => checkPassword('x'.repeat(129)), { status: 400 });
  assert.equal(checkPassword('12345678'), '12345678');
});

test('注册：同一邮箱只能注册一次', () => {
  const db = openDb(':memory:');
  const user = createUser(db, 'a@qq.com', 'scrypt$hash');
  assert.equal(user.email, 'a@qq.com');
  assert.equal(createUser(db, 'a@qq.com', 'scrypt$other'), null);
  assert.equal(findUserByEmail(db, 'a@qq.com').passwordHash, 'scrypt$hash');
  assert.equal(findUserByEmail(db, 'b@qq.com'), null);
});

test('登录失败与注册的频率限制', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  for (let i = 0; i < LIMITS.loginFail.perEmail; i += 1) logAuthEvent(db, 'login_fail', 'a@qq.com', 'ip', now);
  assert.equal(loginBlocked(db, 'a@qq.com', 'other', now + 1000), true);
  assert.equal(loginBlocked(db, 'b@qq.com', 'other', now + 1000), false);
  assert.equal(loginBlocked(db, 'a@qq.com', 'other', now + LIMITS.loginFail.windowMs + 1), false);
  clearLoginFails(db, 'a@qq.com');
  assert.equal(loginBlocked(db, 'a@qq.com', 'other', now + 1000), false);

  for (let i = 0; i < LIMITS.loginFail.perIp; i += 1) logAuthEvent(db, 'login_fail', `u${i}@qq.com`, 'busy', now);
  assert.equal(loginBlocked(db, 'new@qq.com', 'busy', now + 1000), true);

  for (let i = 0; i < LIMITS.register.perIp; i += 1) logAuthEvent(db, 'register', `r${i}@qq.com`, 'farm', now);
  assert.equal(registerBlocked(db, 'farm', now + 1000), true);
  assert.equal(registerBlocked(db, 'farm', now + LIMITS.register.windowMs + 1), false);
});

test('登录会话：创建、查询、过期与退出', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  const user = createUser(db, 'a@qq.com', 'scrypt$x', now);
  const first = createSession(db, user, now);
  const again = createSession(db, user, now);
  assert.equal(first.user.id, again.user.id);
  assert.deepEqual(userForToken(db, first.token, now), { id: first.user.id, email: 'a@qq.com' });
  assert.equal(userForToken(db, first.token, first.expiresAt + 1), null);
  assert.equal(userForToken(db, 'nope', now), null);
  deleteSession(db, first.token);
  assert.equal(userForToken(db, first.token, now), null);
  assert.ok(userForToken(db, again.token, now));
});

test('问事记录：校验、保存、去重与标记', () => {
  const db = openDb(':memory:');
  const { user } = signedIn(db, 'a@qq.com');
  const other = signedIn(db, 'b@qq.com').user;
  const record = sanitizeRecord({
    id: 'r1',
    question: '要不要换工作',
    choice: 'go',
    lean: 'wait',
    mode: 'ming',
    days: ['2026-10-08', 'bad'],
    at: '2026-10-03T08:00:00.000Z',
    reading: '时未至',
    extra: 'ignored',
  });
  assert.deepEqual(record.days, ['2026-10-08']);
  assert.equal(sanitizeRecord({ id: 'r2', question: '', choice: 'go', at: '2026-10-03' }), null);
  assert.equal(sanitizeRecord({ id: '../x', question: 'q', choice: 'go', at: '2026-10-03' }), null);

  saveRecords(db, user.id, [record]);
  saveRecords(db, user.id, [{ ...record, question: '被改写' }]);
  const [saved] = listRecords(db, user.id);
  assert.equal(saved.question, '要不要换工作');
  assert.equal(saved.reading, '时未至');
  assert.equal(listRecords(db, other.id).length, 0);

  assert.equal(setOutcome(db, user.id, 'r1', 'good'), true);
  assert.equal(setOutcome(db, other.id, 'r1', 'bad'), false);
  assert.equal(listRecords(db, user.id)[0].outcome, 'good');
});
