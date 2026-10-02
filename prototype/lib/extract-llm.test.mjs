import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExtractionMessages, parseExtraction } from './extract-llm.mjs';
import { advance, initialState } from './guide.mjs';

const now = new Date(2026, 9, 2);
const read = (data, message = '原话') => parseExtraction(data, message, now);
const birth = (fields) => ({ birth: { calendar: 'solar', leapMonth: false, ...fields } });

test('reads a solar birth date, time, gender and place', () => {
  const facts = read({
    ...birth({ year: 1995, month: 3, day: 8, time: '7:00', gender: 'female', place: '杭州', longitude: 120.16 }),
    question: '要不要辞职做自媒体',
    topic: 'create',
    horizonMonths: 6,
    isNewQuestion: true,
  });
  assert.equal(facts.birthDate, '1995-03-08');
  assert.equal(facts.birthTime, '07:00');
  assert.equal(facts.gender, 'female');
  assert.deepEqual(facts.place, { name: '杭州', longitude: 120.2 });
  assert.equal(facts.topic, 'create');
  assert.equal(facts.horizon, 6);
  assert.equal(facts.questionText, '要不要辞职做自媒体');
  assert.equal(facts.newQuestion, true);
});

test('converts lunar dates locally, including leap months', () => {
  assert.equal(read(birth({ calendar: 'lunar', year: 1995, month: 2, day: 8 })).birthDate, '1995-03-08');
  assert.equal(read(birth({ calendar: 'lunar', year: 1990, month: 12, day: 23 })).birthDate, '1991-02-07');
  // 2020 had a leap fourth month.
  assert.equal(read(birth({ calendar: 'lunar', year: 2020, month: 4, day: 1, leapMonth: true })).birthDate, '2020-05-23');
});

test('distinguishes unknown from unmentioned birth time', () => {
  assert.equal(read(birth({ time: 'unknown' })).birthTime, null);
  assert.equal(read(birth({ time: null })).birthTime, undefined);
  assert.equal(read(birth({ time: '25:00' })).birthTime, undefined);
});

test('drops anything out of range rather than guessing', () => {
  const facts = read({
    ...birth({ year: 2030, month: 1, day: 1, gender: 'other', place: '某地', longitude: 300 }),
    topic: 'astrology',
    horizonMonths: 2,
    confirmation: 'maybe',
  });
  assert.equal(facts.birthDate, null);
  assert.equal(facts.gender, null);
  assert.deepEqual(facts.place, { name: '某地', longitude: null });
  assert.equal(facts.topic, null);
  assert.equal(facts.horizon, null);
  assert.equal(facts.confirmation, null);
  assert.equal(read(birth({ year: 1995, month: 2, day: 30 })).birthDate, null);
});

test('accepts fenced JSON and rejects garbage', () => {
  assert.equal(read('```json\n{"confirmation":"yes"}\n```').confirmation, true);
  assert.equal(read('{"confirmation":"no"}').confirmation, false);
  assert.equal(read('not json'), null);
  assert.equal(read([1, 2]), null);
});

test('without a new question, the message itself stands in', () => {
  const facts = read({ birth: {} }, '对的');
  assert.equal(facts.questionText, '对的');
  assert.equal(facts.isQuestion, false);
});

test('extraction prompt carries the conversation context', () => {
  const [system, user] = buildExtractionMessages('对', { phase: 'confirm', lastGuideLine: '所记如此 可对', today: now });
  assert.match(system.content, /只输出一个 JSON 对象/);
  const data = JSON.parse(user.content);
  assert.equal(data.司命上一句, '所记如此 可对');
  assert.equal(data.对话阶段, 'confirm');
});

test('the guide uses model-read facts when given', () => {
  const facts = read({
    ...birth({ year: 1995, month: 3, day: 8, time: '07:00', gender: 'female' }),
    question: '要不要换工作',
    topic: 'career',
    isNewQuestion: true,
  });
  // The local rules couldn't read this message at all; the model's facts carry it.
  const state = { ...initialState(), mode: 'ming' };
  const result = advance({ state, message: '嗯……就是那个事', facts, now });
  assert.equal(result.state.phase, 'confirm');
  assert.equal(result.state.question, '要不要换工作');
  assert.equal(result.state.topic, 'career');
});
