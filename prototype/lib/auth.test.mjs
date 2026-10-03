import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkVerifyCode, percentEncode, sendVerifyCode, signParams } from './aliyun-sms.mjs';
import { clientIp, maskPhone, normalizeCode, normalizePhone, readCookie } from './auth.mjs';
import {
  LIMITS,
  createSession,
  deleteSession,
  listRecords,
  logAuthEvent,
  openDb,
  sanitizeRecord,
  saveRecords,
  sendBlockedReason,
  setOutcome,
  userForToken,
  verifyBlocked,
} from './db.mjs';

test('签名与阿里云文档示例一致', () => {
  const signed = signParams(
    {
      AccessKeyId: 'testid',
      Action: 'DescribeRegions',
      Format: 'XML',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf',
      SignatureVersion: '1.0',
      Timestamp: '2016-02-23T12:46:24Z',
      Version: '2014-05-26',
    },
    'testsecret',
    'GET',
  );
  assert.equal(signed.Signature, 'OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
});

test('percentEncode 按 RFC 3986 编码', () => {
  assert.equal(percentEncode("a b*c~d!'()"), 'a%20b%2Ac~d%21%27%28%29');
  assert.equal(percentEncode('{"code":"##code##"}'), '%7B%22code%22%3A%22%23%23code%23%23%22%7D');
});

const settings = {
  mock: false,
  accessKeyId: 'id',
  accessKeySecret: 'secret',
  signName: '速通互联验证码',
  templateCode: '100001',
  schemeName: '',
};

function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, params: Object.fromEntries(new URLSearchParams(init.body)) });
    return new Response(JSON.stringify(reply));
  };
  return { calls, impl };
}

test('发送验证码带上签名、模板与有效期', async () => {
  const { calls, impl } = fakeFetch({ Code: 'OK', Model: {} });
  await sendVerifyCode('13800138000', settings, impl);
  const { params } = calls[0];
  assert.equal(params.Action, 'SendSmsVerifyCode');
  assert.equal(params.PhoneNumber, '13800138000');
  assert.equal(params.SignName, '速通互联验证码');
  assert.equal(params.TemplateParam, '{"code":"##code##","min":"5"}');
  assert.equal(params.CodeLength, '6');
  assert.ok(params.Signature);
  // 签名可由其余参数复现。
  const { Signature, ...rest } = params;
  assert.equal(signParams(rest, 'secret').Signature, Signature);
});

test('阿里云报错转为友好提示', async () => {
  const { impl } = fakeFetch({ Code: 'biz.FREQUENCY', Message: 'check frequency failed' });
  await assert.rejects(sendVerifyCode('13800138000', settings, impl), { name: 'SmsError', status: 429, message: /频繁/ });
  const { impl: unknown } = fakeFetch({ Code: 'isv.SOMETHING', Message: 'x' });
  await assert.rejects(sendVerifyCode('13800138000', settings, unknown), { status: 502 });
  await assert.rejects(sendVerifyCode('13800138000', { ...settings, accessKeyId: '' }, unknown), { status: 503 });
});

test('校验结果只认 PASS', async () => {
  assert.equal(await checkVerifyCode('13800138000', '123456', settings, fakeFetch({ Code: 'OK', Model: { VerifyResult: 'PASS' } }).impl), true);
  assert.equal(await checkVerifyCode('13800138000', '123456', settings, fakeFetch({ Code: 'OK', Model: { VerifyResult: 'UNKNOWN' } }).impl), false);
  assert.equal(await checkVerifyCode('13800138000', '000000', { ...settings, mock: true }), true);
  assert.equal(await checkVerifyCode('13800138000', '123456', { ...settings, mock: true }), false);
});

test('手机号与验证码格式', () => {
  assert.equal(normalizePhone('138 0013-8000'), '13800138000');
  assert.equal(normalizePhone('+8613800138000'), '13800138000');
  assert.throws(() => normalizePhone('12800138000'), { status: 400 });
  assert.throws(() => normalizePhone(13800138000), { status: 400 });
  assert.equal(normalizeCode(' 123456 '), '123456');
  assert.throws(() => normalizeCode('12a456'), { status: 400 });
  assert.equal(maskPhone('13800138000'), '138****8000');
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

test('登录会话：创建、查询、过期与退出', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  const first = createSession(db, '13800138000', now);
  const again = createSession(db, '13800138000', now);
  assert.equal(first.user.id, again.user.id);
  assert.deepEqual(userForToken(db, first.token, now), { id: first.user.id, phone: '13800138000' });
  assert.equal(userForToken(db, first.token, first.expiresAt + 1), null);
  assert.equal(userForToken(db, 'nope', now), null);
  deleteSession(db, first.token);
  assert.equal(userForToken(db, first.token, now), null);
  assert.ok(userForToken(db, again.token, now));
});

test('发送与校验频率限制', () => {
  const db = openDb(':memory:');
  const now = Date.now();
  assert.equal(sendBlockedReason(db, '13800138000', 'ip', now), null);
  logAuthEvent(db, 'send', '13800138000', 'ip', now);
  assert.match(sendBlockedReason(db, '13800138000', 'ip', now + 30_000), /一分钟/);
  assert.equal(sendBlockedReason(db, '13800138000', 'ip', now + 61_000), null);
  for (let i = 1; i < LIMITS.send.phoneDaily; i += 1) logAuthEvent(db, 'send', '13800138000', 'ip', now + i * 61_000);
  assert.match(sendBlockedReason(db, '13800138000', 'other', now + 3_600_000), /上限/);

  for (let i = 0; i < LIMITS.verify.phoneFails; i += 1) logAuthEvent(db, 'verify_fail', '13900139000', 'ip', now);
  assert.equal(verifyBlocked(db, '13900139000', now + 1000), true);
  assert.equal(verifyBlocked(db, '13900139000', now + LIMITS.verify.windowMs + 1), false);
});

test('问事记录：校验、保存、去重与标记', () => {
  const db = openDb(':memory:');
  const { user } = createSession(db, '13800138000');
  const other = createSession(db, '13900139000').user;
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
