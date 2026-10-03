import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clientIp, maskEmail, normalizeCode, normalizeEmail, readCookie } from './auth.mjs';
import {
  CODE_MINUTES,
  LIMITS,
  consumeLoginCode,
  createSession,
  deleteSession,
  issueLoginCode,
  listRecords,
  logAuthEvent,
  openDb,
  sanitizeRecord,
  saveRecords,
  sendBlockedReason,
  setOutcome,
  userForToken,
} from './db.mjs';
import { loginMail, mailSettings, sendLoginCode } from './mailer.mjs';

test('邮箱与验证码格式', () => {
  assert.equal(normalizeEmail('  Foo.Bar+x@QQ.com '), 'foo.bar+x@qq.com');
  assert.throws(() => normalizeEmail('foo@'), { status: 400 });
  assert.throws(() => normalizeEmail('foo@bar'), { status: 400 });
  assert.throws(() => normalizeEmail('a b@qq.com'), { status: 400 });
  assert.throws(() => normalizeEmail(`${'a'.repeat(250)}@qq.com`), { status: 400 });
  assert.throws(() => normalizeEmail(42), { status: 400 });
  assert.equal(normalizeCode(' 012345 '), '012345');
  assert.throws(() => normalizeCode('12345'), { status: 400 });
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

test('验证码：一次有效、过期失效、重发替换、错满五次作废', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  const code = issueLoginCode(db, 'a@qq.com', now);
  assert.match(code, /^\d{6}$/);
  assert.equal(consumeLoginCode(db, 'b@qq.com', code, now), false);
  assert.equal(consumeLoginCode(db, 'a@qq.com', code, now + 1000), true);
  assert.equal(consumeLoginCode(db, 'a@qq.com', code, now + 2000), false);

  const late = issueLoginCode(db, 'a@qq.com', now);
  assert.equal(consumeLoginCode(db, 'a@qq.com', late, now + CODE_MINUTES * 60_000 + 1), false);

  const first = issueLoginCode(db, 'a@qq.com', now);
  const second = issueLoginCode(db, 'a@qq.com', now);
  if (first !== second) assert.equal(consumeLoginCode(db, 'a@qq.com', first, now), false);
  assert.equal(consumeLoginCode(db, 'a@qq.com', second, now), true);

  const guarded = issueLoginCode(db, 'a@qq.com', now);
  const wrong = guarded === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) assert.equal(consumeLoginCode(db, 'a@qq.com', wrong, now), false);
  assert.equal(consumeLoginCode(db, 'a@qq.com', guarded, now), false);
});

test('发送频率限制', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  assert.equal(sendBlockedReason(db, 'a@qq.com', 'ip', now), null);
  logAuthEvent(db, 'send', 'a@qq.com', 'ip', now);
  assert.match(sendBlockedReason(db, 'a@qq.com', 'ip', now + 30_000), /一分钟/);
  assert.equal(sendBlockedReason(db, 'a@qq.com', 'ip', now + 61_000), null);
  for (let i = 1; i < LIMITS.send.emailDaily; i += 1) logAuthEvent(db, 'send', 'a@qq.com', 'ip', now + i * 61_000);
  assert.match(sendBlockedReason(db, 'a@qq.com', 'other', now + 3_600_000), /上限/);
  for (let i = 0; i < LIMITS.send.ipHourly; i += 1) logAuthEvent(db, 'send', `u${i}@qq.com`, 'busy', now);
  assert.match(sendBlockedReason(db, 'new@qq.com', 'busy', now + 1000), /频繁/);
});

test('发信配置与邮件内容', async () => {
  const settings = mailSettings({ SMTP_HOST: 'smtp.qq.com', SMTP_USER: 'me@qq.com', SMTP_PASS: 'x' });
  assert.equal(settings.port, 465);
  assert.equal(settings.secure, true);
  assert.equal(settings.from, '司命 <me@qq.com>');
  assert.equal(mailSettings({ SMTP_PORT: '587' }).secure, false);
  assert.throws(() => mailSettings({ MAIL_MOCK: '1', NODE_ENV: 'production' }), { name: 'MailError' });

  const mail = loginMail('012345', 10);
  assert.match(mail.subject, /012345/);
  assert.match(mail.text, /10 分钟内有效/);

  const sent = [];
  await sendLoginCode('a@qq.com', '012345', 10, settings, { sendMail: async (message) => sent.push(message) });
  assert.equal(sent[0].to, 'a@qq.com');
  assert.equal(sent[0].from, '司命 <me@qq.com>');

  await assert.rejects(sendLoginCode('a@qq.com', '1', 10, { ...settings, pass: '' }), { status: 503 });
  const bounce = Object.assign(new Error('mailbox unavailable'), { responseCode: 550 });
  await assert.rejects(
    sendLoginCode('a@qq.com', '1', 10, settings, { sendMail: async () => Promise.reject(bounce) }),
    { status: 400, message: /检查邮箱/ },
  );
});

test('登录会话：创建、查询、过期与退出', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  const first = createSession(db, 'a@qq.com', now);
  const again = createSession(db, 'a@qq.com', now);
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
  const { user } = createSession(db, 'a@qq.com');
  const other = createSession(db, 'b@qq.com').user;
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
