import assert from 'node:assert/strict';
import test from 'node:test';

import { advance, birthFromForm, initialState, sanitizeState, templateReading } from './guide.mjs';

const now = new Date(2026, 9, 2);
const types = (result) => result.steps.map((step) => step.card?.kind ?? step.type);

// Three coins thrown six times, bottom line first; the third line (9) is changing.
const CAST = { action: { type: 'cast', tosses: [7, 8, 9, 7, 8, 7] } };
const GUA = { action: { type: 'mode', mode: 'gua' } };
const MING = { action: { type: 'mode', mode: 'ming' } };
const BIRTH = '1995年3月8号早上7点，杭州，女';
const PROFILE = { date: '1995-03-08', time: '07:00', gender: 'female', longitude: 120.2 };

function talk(...turns) {
  let state = initialState();
  let result;
  for (const turn of turns) {
    result = advance({ state, now, ...(typeof turn === 'string' ? { message: turn } : turn) });
    state = result.state;
  }
  return result;
}

// ---------- Choosing the way ----------

test('a question before choosing asks which way to look at it', () => {
  const result = talk('要不要换工作');
  assert.equal(result.state.phase, 'choose');
  assert.equal(result.state.question, '要不要换工作');
  assert.deepEqual(types(result), ['say', 'modes']);
});

test('choosing first, then asking', () => {
  const chosen = talk(GUA);
  assert.equal(chosen.state.mode, 'gua');
  assert.equal(chosen.state.phase, 'question');
  assert.deepEqual(types(chosen), ['say']);
  const asked = talk(GUA, '要不要换工作');
  assert.equal(asked.state.phase, 'cast');
});

test('the way can also be named in words', () => {
  assert.equal(talk('要不要换工作', '起卦吧').state.phase, 'cast');
  assert.equal(talk('要不要换工作', '看八字').state.phase, 'birth');
});

test('a question that names its way goes straight on', () => {
  const named = talk('要不要开店 看八字');
  assert.equal(named.state.phase, 'birth');
  assert.equal(named.state.question, '要不要开店');
  assert.equal(talk('要不要开店 起一卦').state.phase, 'cast');
  assert.equal(talk('要不要开店 帮我起卦').state.phase, 'cast');
});

test('after a decision the next matter is chosen afresh', () => {
  const result = talk(GUA, '要不要换工作', CAST, { action: { type: 'decide', choice: 'stop' } }, '要不要搬家');
  assert.equal(result.state.phase, 'choose');
  assert.equal(result.state.mode, null);
});

// ---------- 起卦: the hexagram alone ----------

test('casting needs no birth details', () => {
  const result = talk(GUA, '要不要换工作');
  assert.deepEqual(types(result), ['say', 'cast']);
  assert.deepEqual(result.state.birth, {});
});

test('throwing the coins reveals the hexagram and reads it alone', () => {
  const result = talk(GUA, '要不要换工作', CAST);
  assert.equal(result.state.phase, 'reading');
  assert.deepEqual(types(result), ['gua', 'reading']);
  assert.deepEqual(result.steps[0].card.changing, [2]);
  const { reading } = result.steps[1].payload;
  assert.equal(reading.mode, 'gua');
  assert.equal(reading.chart, undefined, 'no birth chart in a hexagram reading');
  assert.equal(reading.gua.reading[0].label, reading.gua.present.yao[2].label);
  assert.equal(result.state.lean, null);
});

test('bad coin results are refused and the cast is offered again', () => {
  const result = talk(GUA, '要不要换工作', { action: { type: 'cast', tosses: [7, 8, 9, 7, 8] } });
  assert.equal(result.state.phase, 'cast');
  assert.deepEqual(types(result), ['cast']);
});

test('talking before casting points back to the coins', () => {
  const result = talk(GUA, '要不要换工作', '我准备好了');
  assert.equal(result.state.phase, 'cast');
  assert.deepEqual(types(result), ['say', 'cast']);
});

test('deciding after a cast gives no dates', () => {
  const result = talk(GUA, '要不要换工作', CAST, { action: { type: 'decide', choice: 'go' } });
  assert.equal(result.state.phase, 'decided');
  assert.deepEqual(types(result), ['say']);
});

test('a new question during a hexagram reading stays with casting', () => {
  const result = talk(GUA, '要不要换工作', CAST, '要不要买房');
  assert.equal(result.state.mode, 'gua');
  assert.equal(result.state.phase, 'cast');
});

test('the hexagram template names the cast and quotes it', () => {
  const result = talk(GUA, '要不要换工作', CAST);
  const payload = result.steps.at(-1).payload;
  const text = templateReading(payload);
  const { present, future } = payload.reading.gua;
  assert.ok(text.startsWith(`得${present.name}之${future.name}`));
  const paragraphs = text.split('\n\n');
  assert.equal(paragraphs.length, 4);
  assert.ok(paragraphs[1].startsWith('所占之辞曰'));
  assert.ok(paragraphs[2].includes(`由${present.name}而${future.name}`));
  assert.doesNotMatch(text, /[，；。：、！？“”]/);
});

// ---------- 观命: the birth chart alone ----------

test('reading the chart asks for birth details with the form', () => {
  const result = talk(MING, '要不要换工作');
  assert.equal(result.state.phase, 'birth');
  assert.equal(result.state.topic, 'career');
  assert.deepEqual(types(result), ['say', 'birth-form']);
});

test('submitting the birth form draws the chart and reads it, without coins', () => {
  const result = talk(MING, '要不要换工作', {
    action: {
      type: 'submit_birth',
      birth: { calendar: 'lunar', year: 1995, month: 2, day: 8, leapMonth: false, time: '08:00', gender: 'female', place: '杭州' },
    },
  });
  assert.equal(result.state.phase, 'reading');
  assert.deepEqual(types(result), ['profile', 'say', 'chart', 'reading']);
  assert.deepEqual(result.steps[0].birth, {
    date: '1995-03-08',
    time: '08:00',
    gender: 'female',
    place: '杭州',
    longitude: 120.2,
  });
  const { reading } = result.steps.at(-1).payload;
  assert.equal(reading.mode, 'ming');
  assert.equal(reading.gua, undefined, 'no hexagram in a chart reading');
  assert.ok(['go', 'wait', 'stop'].includes(result.state.lean.lean));
});

test('an invalid birth form is sent back', () => {
  const result = talk(MING, '要不要换工作', {
    action: { type: 'submit_birth', birth: { calendar: 'solar', year: 1995, month: 2, day: 30, gender: 'female', time: null } },
  });
  assert.equal(result.state.phase, 'birth');
  assert.deepEqual(types(result), ['say', 'birth-form']);
});

test('birthFromForm drops unknown places and accepts unknown time', () => {
  const birth = birthFromForm(
    { calendar: 'solar', year: 1990, month: 12, day: 23, time: 'unknown', gender: 'male', place: '火星' },
    now,
  );
  assert.deepEqual(birth, { date: '1990-12-23', time: null, gender: 'male' });
  assert.equal(birthFromForm({ calendar: 'solar', year: 1990, month: 12, day: 23, time: '25:00', gender: 'male' }, now), null);
});

test('typed birth details still work, asking only for what is missing', () => {
  const result = talk(MING, '要不要换工作', '1995年3月8号早上7点');
  assert.equal(result.state.phase, 'birth');
  assert.match(result.steps[0].text, /男女/);
  assert.doesNotMatch(result.steps[0].text, /生年月日/);
});

test('typed birth details are confirmed on the birth card', () => {
  const card = talk(MING, '要不要换工作', BIRTH);
  assert.equal(card.state.phase, 'confirm');
  assert.deepEqual(types(card), ['say', 'birth']);
  assert.equal(card.steps[1].card.lunar, '农历二月初八');
  const corrected = talk(MING, '要不要换工作', BIRTH, '不对，是晚上7点');
  assert.equal(corrected.state.birth.time, '19:00');
  const confirmed = talk(MING, '要不要换工作', BIRTH, '对');
  assert.deepEqual(types(confirmed), ['profile', 'say', 'chart', 'reading']);
});

test('birth details mentioned before choosing are kept for the chart', () => {
  const result = talk(`要不要换工作 我${BIRTH}`, MING);
  assert.equal(result.state.phase, 'confirm');
  assert.equal(result.state.birth.date, '1995-03-08');
});

test('a saved birth goes straight to the reading, without replaying the chart', () => {
  const state = advance({ state: initialState(), profile: PROFILE, action: MING.action, now }).state;
  const result = advance({ state, profile: PROFILE, message: '要不要表白', now });
  assert.equal(result.state.phase, 'reading');
  assert.deepEqual(types(result), ['reading']);
});

test('changing the horizon recomputes the chart reading', () => {
  const result = talk(MING, '要不要换工作', BIRTH, '对', '看半年');
  assert.equal(result.state.horizon, 6);
  const reading = result.steps.find((step) => step.type === 'reading');
  assert.equal(reading.payload.reading.timing.points.length, 6);
});

test('other follow-ups go to the model', () => {
  const result = talk(MING, '要不要换工作', BIRTH, '对', '那我该注意什么');
  assert.deepEqual(types(result), ['followup']);
  assert.equal(result.steps[0].payload.mode, 'ming');
});

test('acting on a chart reading picks auspicious days', () => {
  const result = talk(MING, '要不要换工作', BIRTH, '对', { action: { type: 'decide', choice: 'go' } });
  assert.equal(result.state.phase, 'decided');
  assert.ok(types(result).includes('days'));
});

test('stopping ends without days', () => {
  const result = talk(MING, '要不要换工作', BIRTH, '对', { action: { type: 'decide', choice: 'stop' } });
  assert.deepEqual(types(result), ['say']);
});

test('the chart template states the computed lean', () => {
  const result = talk(MING, '要不要换工作', BIRTH, '对');
  const text = templateReading(result.steps.at(-1).payload);
  const expected = { go: '利有攸往', wait: '宜待', stop: '未可强求' }[result.state.lean.lean];
  assert.ok(text.includes(expected));
  const paragraphs = text.split('\n\n');
  assert.equal(paragraphs.length, 5);
  assert.ok(paragraphs[1].startsWith('日主'));
  assert.ok(paragraphs[2].includes(`流年${result.steps.at(-1).payload.reading.signal.liunian.ganzhi}`));
});

// ---------- State from the client ----------

test('a restored reading keeps what it needs, or steps back', () => {
  assert.equal(sanitizeState({ phase: 'reading', mode: 'gua', cast: null }).phase, 'cast');
  assert.equal(sanitizeState({ phase: 'reading', mode: 'gua', cast: [7, 7, 7, 8, 8, 8] }).phase, 'reading');
  assert.equal(sanitizeState({ phase: 'reading', mode: null }).phase, 'question');
  assert.equal(sanitizeState({ mode: 'tarot' }).mode, null);
});

test('sanitizeState drops malformed client state', () => {
  const state = sanitizeState({
    phase: 'hacked',
    topic: 'nope',
    horizon: 99,
    birth: { date: 'x', gender: 'female', time: '07:00', longitude: 500 },
    lean: { lean: 'go', until: '<script>' },
  });
  assert.equal(state.phase, 'question');
  assert.equal(state.topic, null);
  assert.equal(state.horizon, 3);
  assert.deepEqual(state.birth, { gender: 'female', time: '07:00' });
  assert.equal(state.lean.until, null);
});
