import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFacts, looksLikeNonsense } from './extract.mjs';

const now = new Date(2026, 9, 2);
const facts = (text) => extractFacts(text, now);

test('reads a full introduction in one sentence', () => {
  const result = facts('我95年3月8号早上7点生在杭州，女，在纠结要不要和朋友合伙开店');
  assert.equal(result.birthDate, '1995-03-08');
  assert.equal(result.birthTime, '07:00');
  assert.equal(result.gender, 'female');
  assert.deepEqual(result.place, { name: '杭州', longitude: 120.2 });
  assert.equal(result.topic, 'peer');
  assert.equal(result.questionText, '要不要和朋友合伙开店');
});

test('understands spoken dates and times', () => {
  assert.equal(facts('1988年十二月二十三日下午三点').birthDate, '1988-12-23');
  assert.equal(facts('1988年十二月二十三日下午三点').birthTime, '15:00');
  assert.equal(facts('1995.3.8 晚上9点半 男').birthTime, '21:30');
  assert.equal(facts('2001-07-15 男').gender, 'male');
  assert.equal(facts('辰时出生').birthTime, '08:00');
  assert.equal(facts('凌晨3:40').birthTime, '03:40');
});

test('converts lunar dates to the solar calendar', () => {
  assert.equal(facts('1995年农历二月初八').birthDate, '1995-03-08');
  assert.equal(facts('九五年二月初八').birthDate, '1995-03-08');
  assert.equal(facts('90年腊月廿三').birthDate, '1991-02-07');
});

test('distinguishes unknown from unmentioned birth time', () => {
  assert.equal(facts('女生，时辰不记得了，1990年12月23号').birthTime, null);
  assert.equal(facts('1990年12月23号').birthTime, undefined);
});

test('rejects impossible or future dates', () => {
  assert.equal(facts('1995年2月30日').birthDate, null);
  assert.equal(facts('2030年1月1日').birthDate, null);
});

test('reads horizon, topic and confirmation', () => {
  assert.equal(facts('看半年吧').horizon, 6);
  assert.equal(facts('这个月内').horizon, 1);
  assert.equal(facts('要不要表白').topic, 'love');
  assert.equal(facts('要不要考研').topic, 'study');
  assert.equal(facts('对的').confirmation, true);
  assert.equal(facts('不对，是下午').confirmation, false);
  assert.equal(facts('明天吃什么').confirmation, null);
});

test('tells gibberish from short but real words', () => {
  for (const junk of ['asdfghjkl', 'qwer', 'sdfsdf', '哈哈哈', '嗯嗯', '？？？', '。。。', '1234', '啊', 'xkcdzq', '   ']) {
    assert.equal(looksLikeNonsense(junk), true, junk);
  }
  for (const real of ['要不要辞职', '辞职', '谢谢', '起卦', '观命', 'offer', '换工作还是留下', 'should I quit']) {
    assert.equal(looksLikeNonsense(real), false, real);
  }
  assert.equal(extractFacts('asdfgh').meaningful, false);
  assert.equal(extractFacts('要不要换工作').meaningful, true);
});
