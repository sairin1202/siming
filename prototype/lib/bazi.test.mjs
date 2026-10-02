import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRANCHES,
  BaziInputError,
  STEMS,
  TOPICS,
  buildChart,
  computeLean,
  computeSignal,
  computeTiming,
  pickAuspiciousDays,
  shishenOf,
} from './bazi.mjs';

// Independent of lunar-javascript: day ganzhi index = (JDN + 49) mod 60.
function expectedDayGanzhi(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn =
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;
  const index = (jdn + 49) % 60;
  return STEMS[index % 10] + BRANCHES[index % 12];
}

const pillar = (value) => value.stem + value.branch;

const sample = buildChart({
  date: '1995-03-08',
  time: '07:00',
  longitude: 120,
  gender: 'female',
});

test('buildChart matches known pillars and luck cycles', () => {
  assert.deepEqual(
    Object.values(sample.pillars).map(pillar),
    ['乙亥', '己卯', '戊戌', '丙辰'],
  );
  assert.equal(sample.dayMaster.stem, '戊');
  // Female, yin year stem: luck runs forward from the month pillar.
  assert.deepEqual(
    sample.dayun.slice(0, 3).map((item) => item.ganzhi),
    ['庚辰', '辛巳', '壬午'],
  );
});

test('day pillar agrees with Julian day arithmetic', () => {
  for (const date of ['1949-10-01', '1984-02-02', '2000-01-01', '2024-02-29', '2031-12-31']) {
    const [year, month, day] = date.split('-').map(Number);
    const chart = buildChart({ date, time: '12:00', gender: 'male' });
    assert.equal(pillar(chart.pillars.day), expectedDayGanzhi(year, month, day), date);
  }
});

test('year and month pillars switch at 立春, not at new year', () => {
  // 立春 2024 fell at 16:27 Beijing time on 4 February.
  const before = buildChart({ date: '2024-02-04', time: '16:00', longitude: 120, gender: 'male' });
  const after = buildChart({ date: '2024-02-04', time: '17:00', longitude: 120, gender: 'male' });
  assert.equal(pillar(before.pillars.year), '癸卯');
  assert.equal(pillar(before.pillars.month), '乙丑');
  assert.equal(pillar(after.pillars.year), '甲辰');
  assert.equal(pillar(after.pillars.month), '丙寅');
});

test('longitude shifts the clock to local solar time', () => {
  // Urumqi is about 130 minutes behind Beijing in solar time.
  const chart = buildChart({ date: '2024-02-04', time: '16:40', longitude: 87.6, gender: 'male' });
  assert.equal(chart.solarTime, '2024-02-04 14:30:00');
  assert.equal(pillar(chart.pillars.year), '癸卯');
});

test('unknown birth time drops the hour pillar', () => {
  const chart = buildChart({ date: '1995-03-08', time: null, gender: 'female' });
  assert.equal(chart.hourKnown, false);
  assert.equal(chart.pillars.hour, null);
  assert.equal(pillar(chart.pillars.day), '戊戌');
});

test('late 子 hour keeps the hour branch at 子', () => {
  const chart = buildChart({ date: '1995-03-08', time: '23:30', longitude: 120, gender: 'female' });
  assert.equal(chart.pillars.hour.branch, '子');
});

test('buildChart rejects invalid input', () => {
  assert.throws(() => buildChart({ date: '1995-02-30', gender: 'male' }), BaziInputError);
  assert.throws(() => buildChart({ date: '1995-03-08', time: '25:00', gender: 'male' }), BaziInputError);
  assert.throws(() => buildChart({ date: '1995-03-08', gender: 'x' }), BaziInputError);
});

test('shishenOf follows element and polarity', () => {
  assert.equal(shishenOf('戊', '戊'), '比肩');
  assert.equal(shishenOf('戊', '己'), '劫财');
  assert.equal(shishenOf('戊', '庚'), '食神');
  assert.equal(shishenOf('戊', '辛'), '伤官');
  assert.equal(shishenOf('戊', '壬'), '偏财');
  assert.equal(shishenOf('戊', '癸'), '正财');
  assert.equal(shishenOf('戊', '甲'), '七杀');
  assert.equal(shishenOf('戊', '乙'), '正官');
  assert.equal(shishenOf('戊', '丙'), '偏印');
  assert.equal(shishenOf('戊', '丁'), '正印');
});

test('favorable elements are the complement of unfavorable ones', () => {
  assert.equal(sample.favorable.length + sample.unfavorable.length, 5);
  assert.ok(sample.favorable.every((element) => !sample.unfavorable.includes(element)));
});

test('computeSignal is deterministic and bounded for every topic', () => {
  const date = new Date(2026, 9, 2);
  for (const topic of TOPICS) {
    const first = computeSignal(sample, topic, date);
    assert.deepEqual(computeSignal(sample, topic, date), first);
    assert.ok(first.score >= 0 && first.score <= 100);
    assert.equal(first.liunian.ganzhi, '丙午');
    assert.equal(first.liuyue.ganzhi, '丁酉');
    assert.equal(first.dayun.ganzhi, '壬午');
  }
  assert.throws(() => computeSignal(sample, 'unknown', date), BaziInputError);
});

test('computeSignal only cites ganzhi it computed', () => {
  const signal = computeSignal(sample, 'wealth', new Date(2026, 9, 2));
  const known = new Set(
    [signal.dayun.ganzhi, signal.liunian.ganzhi, signal.liuyue.ganzhi].join(''),
  );
  for (const note of [...signal.pros, ...signal.cons]) {
    for (const match of note.matchAll(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g)) {
      assert.ok(match[0].split("").every((char) => known.has(char)), note);
    }
  }
});

test('computeTiming covers the horizon and finds the best month', () => {
  const timing = computeTiming(sample, 'create', new Date(2026, 9, 2), 6);
  assert.equal(timing.points.length, 6);
  assert.equal(timing.points[0].month, '2026-10');
  assert.equal(timing.points[5].month, '2027-03');
  assert.equal(timing.best.score, Math.max(...timing.points.map((point) => point.score)));
});

test('computeLean picks wait, go or stop', () => {
  const timing = (scores) => {
    const points = scores.map((score, index) => ({ month: `m${index}`, ganzhi: '', score }));
    return { points, best: points.reduce((a, b) => (b.score > a.score ? b : a)) };
  };
  assert.deepEqual(computeLean(timing([40, 60, 50])), { lean: 'wait', until: 'm1', score: 40 });
  assert.equal(computeLean(timing([62, 70])).lean, 'go');
  assert.equal(computeLean(timing([42, 50])).lean, 'stop');
});

test('pickAuspiciousDays avoids clashes and keeps days apart', () => {
  const days = pickAuspiciousDays(sample, { from: new Date(2026, 9, 2), days: 30 }, 3);
  assert.equal(days.length, 3);
  const times = days.map((day) => new Date(day.date).getTime());
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(times[index] - times[index - 1] >= 3 * 86_400_000);
  }
  for (const day of days) {
    assert.notEqual(day.ganzhi[1], '辰', '辰 clashes the 戌 day branch');
    assert.ok(day.reasons.length > 0);
  }
});
