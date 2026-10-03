import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFollowupMessages, buildReadingMessages, detectSafetyMode } from './agent.mjs';
import { advance, initialState } from './guide.mjs';

const now = new Date(2026, 9, 2);
const profile = { date: '1995-03-08', time: '07:00', gender: 'female', longitude: 120.2 };
// A hexagram reading: choose casting, ask, throw.
const chosen = advance({ state: initialState(), action: { type: 'mode', mode: 'gua' }, now });
const asked = advance({ state: chosen.state, message: '要不要换工作', now });
const payload = advance({ state: asked.state, action: { type: 'cast', tosses: [7, 8, 9, 7, 8, 7] }, now }).steps.at(-1)
  .payload;
// A chart reading: choose the chart, ask with a saved birth.
const mingState = advance({ state: initialState(), profile, action: { type: 'mode', mode: 'ming' }, now }).state;
const mingPayload = advance({ state: mingState, profile, message: '要不要换工作', now }).steps.at(-1).payload;

test('detectSafetyMode flags crisis and high-stakes topics', () => {
  assert.equal(detectSafetyMode('我想死'), 'crisis');
  assert.equal(detectSafetyMode('要不要把钱投资股票'), 'high_stakes');
  assert.equal(detectSafetyMode('要不要换工作'), 'standard');
});

test('a hexagram reading carries the hexagram and its words, and nothing of the chart', () => {
  const [system, user] = buildReadingMessages(payload, 'standard');
  assert.match(system.content, /不得自造经文/);
  assert.match(system.content, /不涉生辰命理/);
  assert.match(system.content, /写五段/);
  assert.match(system.content, /一百五十至二百二十字/);
  assert.match(system.content, /不要用任何标点符号/);
  const data = JSON.parse(user.content.slice(user.content.indexOf('{')));
  assert.equal(data.问题, '要不要换工作');
  assert.equal(data.卦.本卦.卦名, payload.reading.gua.present.name);
  assert.equal(data.卦.所占之辞[0].原文, payload.reading.gua.reading[0].text);
  assert.equal(data.流年, undefined);
  assert.equal(data.结论, undefined);
});

test('a chart reading carries the timing and the fixed lean, and no hexagram', () => {
  const [system, user] = buildReadingMessages(mingPayload, 'standard');
  assert.match(system.content, /不涉卦象/);
  assert.match(system.content, /一百五十至二百二十字/);
  assert.match(system.content, /不得自造干支/);
  const data = JSON.parse(user.content.slice(user.content.indexOf('{')));
  assert.equal(data.流年, mingPayload.reading.signal.liunian.ganzhi);
  assert.ok(data.结论.startsWith({ go: '宜行', wait: '待时', stop: '宜止' }[mingPayload.reading.lean.lean]));
  assert.equal(data.卦, undefined);
});

test('high-stakes readings must point to professionals', () => {
  const [system] = buildReadingMessages(payload, 'high_stakes');
  assert.match(system.content, /专业之士/);
});

test('follow-up prompt keeps recent history and the question', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({ from: index % 2 ? 'guide' : 'user', text: `第${index}句` }));
  const [, user] = buildFollowupMessages({ ...payload, message: '那下个月呢' }, history, 'standard');
  const data = JSON.parse(user.content.slice(user.content.indexOf('{')));
  assert.equal(data.追问, '那下个月呢');
  assert.equal(data.最近对话.length, 8);
  assert.match(buildFollowupMessages({ ...payload, message: '那下个月呢' }, history, 'standard')[0].content, /四十至八十字/);
});
