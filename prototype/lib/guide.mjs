// Conversation flow for 司命, the guide. Pure functions: the route feeds in
// the client's state and a message or action, and gets back the next state
// plus the steps to stream. Readings and follow-ups are marked for the model;
// every other line the guide says is written here.

import lunar from 'lunar-javascript';

import {
  TOPICS,
  buildChart,
  computeLean,
  computeSignal,
  computeTiming,
  pickAuspiciousDays,
} from './bazi.mjs';
import { CITIES } from './cities.mjs';
import { extractFacts } from './extract.mjs';
import { castHexagram, parseTosses } from './gua.mjs';
import { solarDateOf } from './extract-llm.mjs';

const { Solar } = lunar;

export const TOPIC_LABELS = {
  career: '事业',
  wealth: '财',
  study: '学业 / 资产',
  create: '创业 / 表达',
  peer: '合伙 / 人际',
  love: '感情',
  other: '综合',
};

export const GREETING = '夜阑人静\n君心有疑 不妨言之';

const MAX_QUESTION_LENGTH = 300;
const DEFAULT_HORIZON = 3;
const HORIZONS = [1, 3, 6, 12];
const SHICHEN = '子丑丑寅寅卯卯辰辰巳巳午午未未申申酉酉戌戌亥亥子';

export function initialState() {
  return {
    phase: 'question',
    question: null,
    topic: null,
    horizon: DEFAULT_HORIZON,
    birth: {},
    readings: 0,
    lean: null,
    // The six thrown values for the current question, bottom line first.
    cast: null,
    // How this question is looked at: 'gua' (cast a hexagram) or 'ming' (read the birth chart).
    mode: null,
  };
}

export const MODES = ['gua', 'ming'];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const PHASES = ['question', 'choose', 'birth', 'confirm', 'cast', 'reading', 'decided'];

/** Keep only well-formed fields from client-held state. */
export function sanitizeState(raw) {
  const state = initialState();
  if (!isRecord(raw)) return state;
  if (PHASES.includes(raw.phase)) state.phase = raw.phase;
  if (typeof raw.question === 'string') state.question = raw.question.slice(0, MAX_QUESTION_LENGTH);
  if (TOPICS.includes(raw.topic)) state.topic = raw.topic;
  if (HORIZONS.includes(raw.horizon)) state.horizon = raw.horizon;
  if (Number.isInteger(raw.readings) && raw.readings >= 0) state.readings = raw.readings;
  if (isRecord(raw.lean) && ['go', 'wait', 'stop'].includes(raw.lean.lean)) {
    const until = typeof raw.lean.until === 'string' && /^\d{4}-\d{2}$/.test(raw.lean.until) ? raw.lean.until : null;
    state.lean = { lean: raw.lean.lean, until, score: Number(raw.lean.score) || 0 };
  }
  state.birth = sanitizeBirth(raw.birth);
  state.cast = parseTosses(raw.cast);
  state.mode = MODES.includes(raw.mode) ? raw.mode : null;
  // A reading needs its mode, and a hexagram reading needs its cast.
  if ((state.phase === 'reading' || state.phase === 'decided') && !state.mode) state.phase = 'question';
  if ((state.phase === 'reading' || state.phase === 'decided') && state.mode === 'gua' && !state.cast) {
    state.phase = 'cast';
  }
  return state;
}

export function sanitizeBirth(raw) {
  const birth = {};
  if (!isRecord(raw)) return birth;
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) birth.date = raw.date;
  if (raw.time === null || (typeof raw.time === 'string' && /^\d{2}:\d{2}$/.test(raw.time))) {
    birth.time = raw.time;
  }
  if (raw.gender === 'male' || raw.gender === 'female') birth.gender = raw.gender;
  if (typeof raw.place === 'string' && raw.place.length <= 20) birth.place = raw.place;
  if (typeof raw.longitude === 'number' && raw.longitude > 70 && raw.longitude < 140) {
    birth.longitude = raw.longitude;
  }
  return birth;
}

export function isBirthComplete(birth) {
  return Boolean(birth.date && birth.gender && birth.time !== undefined);
}

function mergeBirth(birth, facts) {
  const next = { ...birth };
  if (facts.birthDate) next.date = facts.birthDate;
  if (facts.birthTime !== undefined) next.time = facts.birthTime;
  if (facts.gender) next.gender = facts.gender;
  if (facts.place) {
    next.place = facts.place.name;
    next.longitude = facts.place.longitude;
  }
  return next;
}

function hasBirthFacts(facts) {
  return Boolean(facts.birthDate || facts.birthTime !== undefined || facts.gender || facts.place);
}

function chartInput(birth) {
  return {
    date: birth.date,
    time: birth.time ?? null,
    longitude: birth.longitude ?? null,
    gender: birth.gender,
  };
}

export function monthLabel(month) {
  const [year, value] = month.split('-').map(Number);
  return `${year}年${value}月`;
}

function askForBirth(birth) {
  const missing = [];
  if (!birth.date) missing.push('生年月日');
  if (birth.time === undefined) missing.push('时辰');
  if (!birth.gender) missing.push('男女');
  if (!birth.place) missing.push('生地');
  return missing;
}

function birthQuestionText(birth) {
  return `尚缺${askForBirth(birth).join(' ')}`;
}

/** The birth form, prefilled with whatever we already know. */
function formCard(birth) {
  return { kind: 'birth-form', prefill: birth };
}

/**
 * Read the birth form into a birth record, or null if anything is off.
 * @param {unknown} form { calendar, year, month, day, leapMonth, time, gender, place }
 * @param {Date} now
 */
export function birthFromForm(form, now = new Date()) {
  if (!isRecord(form)) return null;
  const date = solarDateOf(
    {
      calendar: form.calendar === 'lunar' ? 'lunar' : 'solar',
      year: Number(form.year),
      month: Number(form.month),
      day: Number(form.day),
      leapMonth: form.leapMonth === true,
    },
    now,
  );
  if (!date) return null;
  if (form.gender !== 'male' && form.gender !== 'female') return null;
  const time =
    form.time === null || form.time === 'unknown'
      ? null
      : typeof form.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(form.time)
        ? form.time
        : undefined;
  if (time === undefined) return null;
  const birth = { date, time, gender: form.gender };
  if (typeof form.place === 'string' && Object.hasOwn(CITIES, form.place)) {
    birth.place = form.place;
    birth.longitude = CITIES[form.place];
  }
  return birth;
}

export function birthCard(birth) {
  const [year, month, day] = birth.date.split('-').map(Number);
  const hour = birth.time ? Number(birth.time.slice(0, 2)) : 12;
  const lunarDate = Solar.fromYmdHms(year, month, day, hour, 0, 0).getLunar();
  const branch = birth.time ? SHICHEN[hour] : null;
  return {
    kind: 'birth',
    solar: `${year}年${month}月${day}日`,
    lunar: `农历${lunarDate.getMonthInChinese()}月${lunarDate.getDayInChinese()}`,
    time: birth.time ?? null,
    shichen: branch ? `${branch}时` : null,
    gender: birth.gender === 'male' ? '男' : '女',
    place: birth.place ?? null,
  };
}

function chartCard(chart) {
  const dayun = chart.dayun.filter((item) => item.startYear <= new Date().getFullYear()).at(-1);
  return {
    kind: 'chart',
    pillars: ['year', 'month', 'day', 'hour'].map((key) => {
      const pillar = chart.pillars[key];
      return pillar ? pillar.stem + pillar.branch : null;
    }),
    dayMaster: `${chart.dayMaster.stem}${chart.dayMaster.element}`,
    strength: chart.strength.label,
    elements: chart.elements,
    favorable: chart.favorable,
    dayun: dayun?.ganzhi ?? null,
    hourKnown: chart.hourKnown,
  };
}

/**
 * Everything the reading is allowed to say, computed locally.
 * @param {ReturnType<typeof sanitizeState>} state
 * @param {Date} now
 */
export function buildReading(state, now) {
  // Casting reads only the hexagram; the birth chart plays no part.
  if (state.mode === 'gua') return { mode: 'gua', gua: castHexagram(state.cast), lean: null };
  const chart = buildChart(chartInput(state.birth));
  const topic = state.topic ?? 'other';
  const signal = computeSignal(chart, topic, now);
  const timing = computeTiming(chart, topic, now, state.horizon);
  const lean = computeLean(timing);
  return { mode: 'ming', chart, signal, timing, lean };
}

/** The two ways in, offered as two seals. */
const modesCard = () => ({ kind: 'modes' });

const MODE_PROMPTS = {
  gua: '一事一问 请言所疑',
  ming: '欲观何事之时 请言之',
};

/** Invite the user to still the mind and throw the coins. */
function castSteps(state) {
  return {
    state: { ...state, phase: 'cast', cast: null, lean: null },
    steps: [
      { type: 'say', text: '闭目三息 默念所问' },
      { type: 'card', card: { kind: 'cast' } },
    ],
  };
}

/** Read the birth chart for the question; a newly drawn chart plays the 排盘 animation once. */
function mingSteps(state, now, { chart = false } = {}) {
  const result = readingSteps(state, now, chart ? { intro: '谨为布盘' } : {});
  if (!chart) return result;
  const [intro, ...rest] = result.steps;
  return { ...result, steps: [intro, { type: 'card', card: chartCard(result.reading.chart) }, ...rest] };
}

/** What the reveal shows: the present hexagram, what it turns into, and which lines move. */
function guaCard(gua) {
  return {
    kind: 'gua',
    tosses: gua.tosses,
    changing: gua.changing,
    present: { number: gua.present.number, name: gua.present.name, upper: gua.present.upper, lower: gua.present.lower },
    future: gua.future
      ? { number: gua.future.number, name: gua.future.name, upper: gua.future.upper, lower: gua.future.lower }
      : null,
  };
}

/** Plain-language reading used when the model is unavailable. */
export function templateReading({ reading }) {
  // Classical text is written without punctuation: breaks become spaces.
  const plain = (text) => text.replace(/[，；。：、！？“”‘’《》「」]+/g, ' ').trim();
  if (reading.mode === 'gua') {
    const { gua } = reading;
    const { present, future } = gua;
    // Name the cast and its image, quote the words that answer it, then the turn and a word of counsel.
    const cast = future ? `得${present.name}之${future.name}` : `得${present.name}`;
    const quoted = gua.reading.map((item) => item.text);
    const text = quoted.join('');
    const lines = [`${cast} ${present.upper}上${present.lower}下 ${plain(present.image)}`];
    lines.push(`所占之辞曰 ${plain(quoted.join(''))}`);
    const judgment = quoted.includes(present.judgment) ? '' : `${present.name}之辞曰 ${plain(present.judgment)} `;
    lines.push(
      future
        ? `${judgment}由${present.name}而${future.name} 事将有变 ${future.name}之辞曰 ${plain(future.judgment)}`
        : `${judgment}六爻安静 事未有变 宜守其常`,
    );
    lines.push(
      /凶|厉|吝/.test(text)
        ? '辞有警惕之意 慎之 勿轻动 先察其势 再图进退'
        : /吉|利|亨|无咎/.test(text)
          ? '辞意多吉 可以行之 然当守正 勿恃其顺而怠'
          : '辞意未定 守正以待 观其变而后动',
    );
    return lines.join('\n\n');
  }
  const { chart, signal, timing, lean } = reading;
  const short = (month) => `${Number(month.slice(5))}月`;
  const verdict =
    lean.lean === 'go' ? '利有攸往 此事可为' : lean.lean === 'wait' ? `宜待${short(lean.until)} 时至而后动` : '未可强求 当养其力';
  const nature = `日主${chart.dayMaster.stem}${chart.dayMaster.element} ${chart.strength.label} 喜${chart.favorable.join('')}${chart.hourKnown ? '' : ' 时辰不详 所论其大略耳'}`;
  const helped = signal.pros.length >= signal.cons.length;
  const fortune = `${signal.dayun?.ganzhi ? `大运${signal.dayun.ganzhi} ` : ''}流年${signal.liunian.ganzhi} 流月${signal.liuyue.ganzhi} ${helped ? '助多而阻少' : '阻多而助少'}`;
  const worst = timing.points.reduce((low, point) => (point.score < low.score ? point : low), timing.points[0]);
  const time = [
    timing.best.month === timing.points[0].month ? '今正其时' : `${short(timing.best.month)}最宜`,
    ...(worst.month !== timing.best.month && worst.score < timing.best.score ? [`${short(worst.month)}宜缓`] : []),
  ].join(' ');
  const close = lean.lean === 'stop' ? '必欲为之 小试可也 量力而行' : '择吉日而行 量入为出 勿贪其速';
  return [verdict, nature, fortune, time, close].join('\n\n');
}

export const FOLLOWUP_FALLBACK =
  '此问未能详答\n或更观半年 或另问他事';

function decideSteps(state, choice, now) {
  if (choice === 'stop') {
    return [
      {
        type: 'say',
        text: '知止不殆\n养其力 以俟其时',
      },
    ];
  }
  // A hexagram gives no dates; picking days belongs to the birth chart.
  if (state.mode !== 'ming') return [{ type: 'say', text: '行矣\n愿君利有攸往' }];
  const chart = buildChart(chartInput(state.birth));
  const from =
    state.lean?.lean === 'wait' && state.lean.until
      ? new Date(Number(state.lean.until.slice(0, 4)), Number(state.lean.until.slice(5, 7)) - 1, 1)
      : now;
  const start = from < now ? now : from;
  const days = pickAuspiciousDays(chart, { from: start, days: 30 }, 3);
  if (days.length === 0) {
    return [{ type: 'say', text: '行矣\n月内无甚吉日 择暇日行之可也' }];
  }
  return [
    { type: 'say', text: '行矣 为君择吉日' },
    { type: 'card', card: { kind: 'days', question: state.question, days } },
    { type: 'say', text: '愿君利有攸往' },
  ];
}

function readingSteps(state, now, { intro } = {}) {
  const reading = buildReading(state, now);
  const first = state.readings === 0;
  const next = {
    ...state,
    phase: 'reading',
    readings: state.readings + 1,
    lean: reading.lean ?? null,
  };
  const steps = [];
  if (intro) steps.push({ type: 'say', text: intro });
  steps.push({
    type: 'reading',
    payload: {
      mode: reading.mode,
      question: state.question,
      topic: state.topic ?? 'other',
      horizon: state.horizon,
      reading,
      first,
    },
  });
  return { state: next, steps, reading };
}

function startQuestion(state, text, facts, profile, now) {
  const next = {
    ...state,
    question: facts.questionText.slice(0, MAX_QUESTION_LENGTH),
    topic: facts.topic ?? 'other',
    horizon: facts.horizon ?? DEFAULT_HORIZON,
    lean: null,
    cast: null,
  };
  // A question that names its way (「要不要开店 看八字」) needs no seals.
  if (!next.mode) {
    next.mode = pickedMode(text);
    if (next.mode) next.question = withoutModeWords(next.question) || next.question;
  }
  // Keep any birth details mentioned in passing, in case the chart is chosen later.
  if (next.mode !== 'gua') next.birth = mergeBirth(state.birth, facts);
  return proceed(next, facts, profile, now);
}

/** With a question in hand, go on the chosen way, or ask which way. */
function proceed(state, facts, profile, now) {
  if (!state.mode) {
    return {
      state: { ...state, phase: 'choose' },
      steps: [
        { type: 'say', text: '以何观之' },
        { type: 'card', card: modesCard() },
      ],
    };
  }
  if (state.mode === 'gua') return castSteps(state);

  if (profile && isBirthComplete(profile) && !hasBirthFacts(facts)) {
    return mingSteps({ ...state, birth: profile }, now);
  }
  const birth = mergeBirth(state.birth, facts);
  if (isBirthComplete(birth)) {
    return {
      state: { ...state, birth, phase: 'confirm' },
      steps: [
        { type: 'say', text: '先核生辰' },
        { type: 'card', card: birthCard(birth) },
      ],
    };
  }
  return {
    state: { ...state, birth, phase: 'birth' },
    steps: [
      { type: 'say', text: '欲知其时 先问生辰' },
      { type: 'card', card: formCard(birth) },
    ],
  };
}

const NO_FACTS = { birthDate: null, birthTime: undefined, gender: null, place: null };

/** 「要不要开店 看八字」 → 「要不要开店」: the way named is not part of the question. */
function withoutModeWords(text) {
  return text
    .replace(/[\s，,。]*(帮我|请|给我)?(看一?看|看|观|用|起一?|卜一?|算一?)?(八字|命盘|观命|看命|卦|掷钱)(吧|呢)?[\s。！!]*$/, '')
    .trim();
}

function pickedMode(text) {
  if (/起一?卦|卜一?卦|掷钱|算一?卦/.test(text)) return 'gua';
  if (/观命|看命|八字|命盘|生辰/.test(text)) return 'ming';
  return null;
}

/**
 * Advance the conversation by one user message or button action.
 * @param {{ state: ReturnType<typeof initialState>, profile?: object | null, message?: string, action?: { type: string, choice?: string }, facts?: object | null, now?: Date }} input
 */
export function advance({ state, profile = null, message, action, facts: providedFacts = null, now = new Date() }) {
  if (action?.type === 'mode' && MODES.includes(action.mode)) {
    if (state.phase === 'choose') return proceed({ ...state, mode: action.mode }, NO_FACTS, profile, now);
    if (state.phase === 'question' || state.phase === 'decided') {
      return {
        state: { ...initialStateWith(state), mode: action.mode },
        steps: [{ type: 'say', text: MODE_PROMPTS[action.mode] }],
      };
    }
  }
  if (action?.type === 'confirm_birth' && state.phase === 'confirm') {
    return withProfile(mingSteps(state, now, { chart: true }), state.birth);
  }
  if (action?.type === 'edit_birth' && state.phase === 'confirm') {
    return {
      state: { ...state, phase: 'birth' },
      steps: [
        { type: 'say', text: '何处有讹 请正之' },
        { type: 'card', card: formCard(state.birth) },
      ],
    };
  }
  if (action?.type === 'submit_birth' && (state.phase === 'birth' || state.phase === 'confirm')) {
    const birth = birthFromForm(action.birth, now);
    if (!birth) {
      return {
        state,
        steps: [
          { type: 'say', text: '所书有讹 请再详之' },
          { type: 'card', card: formCard(state.birth) },
        ],
      };
    }
    return withProfile(mingSteps({ ...state, birth }, now, { chart: true }), birth);
  }
  if (action?.type === 'cast' && state.phase === 'cast') {
    const tosses = parseTosses(action.tosses);
    if (!tosses) return { state, steps: [{ type: 'card', card: { kind: 'cast' } }] };
    const result = readingSteps({ ...state, cast: tosses }, now);
    return { state: result.state, steps: [{ type: 'card', card: guaCard(result.reading.gua) }, ...result.steps] };
  }
  if (action?.type === 'decide' && state.phase === 'reading') {
    const choice = action.choice === 'go' ? 'go' : 'stop';
    return { state: { ...state, phase: 'decided' }, steps: decideSteps(state, choice, now) };
  }
  if (typeof message !== 'string' || !message.trim()) {
    return { state, steps: [] };
  }

  const text = message.trim();
  // The route passes facts read by the model; without them, fall back to local rules.
  const facts = providedFacts ?? extractFacts(text, now);

  switch (state.phase) {
    case 'question':
      return startQuestion(state, text, facts, profile, now);

    case 'decided':
      // A new matter: choose again how to look at it.
      return startQuestion(initialStateWith(state), text, facts, profile, now);

    case 'choose': {
      const mode = pickedMode(text);
      if (mode) return proceed({ ...state, mode }, facts, profile, now);
      return startQuestion(state, text, facts, profile, now);
    }

    case 'birth': {
      const birth = mergeBirth(state.birth, facts);
      if (!isBirthComplete(birth)) {
        return {
          state: { ...state, birth },
          steps: [
            { type: 'say', text: hasBirthFacts(facts) ? birthQuestionText(birth) : '生辰请书于帖' },
            { type: 'card', card: formCard(birth) },
          ],
        };
      }
      return {
        state: { ...state, birth, phase: 'confirm' },
        steps: [
          { type: 'say', text: '所记如是 然否' },
          { type: 'card', card: birthCard(birth) },
        ],
      };
    }

    case 'confirm': {
      if (hasBirthFacts(facts)) {
        const birth = mergeBirth(state.birth, facts);
        return {
          state: { ...state, birth },
          steps: [
            { type: 'say', text: '已改 请复观之' },
            { type: 'card', card: birthCard(birth) },
          ],
        };
      }
      if (facts.confirmation === true) {
        return advance({ state, profile, action: { type: 'confirm_birth' }, now });
      }
      return advance({ state, profile, action: { type: 'edit_birth' }, now });
    }

    case 'cast': {
      // Waiting for the coins: a new question starts over; anything else points back to them.
      if (facts.newQuestion) return startQuestion(keepMode(state), text, facts, profile, now);
      return {
        state,
        steps: [
          { type: 'say', text: '心有所问 先掷其钱' },
          { type: 'card', card: { kind: 'cast' } },
        ],
      };
    }

    case 'reading': {
      if (state.mode === 'ming' && facts.horizon && facts.horizon !== state.horizon && !facts.isQuestion) {
        return readingSteps({ ...state, horizon: facts.horizon }, now, {
          intro: `更观其后${facts.horizon}月`,
        });
      }
      if (/换一件|另一件|别的事|再问/.test(text) && text.length < 12) {
        return {
          state: { ...keepMode(state), phase: 'question' },
          steps: [{ type: 'say', text: '又有何事' }],
        };
      }
      if (facts.newQuestion) return startQuestion(keepMode(state), text, facts, profile, now);
      return {
        state,
        steps: [
          {
            type: 'followup',
            payload: {
              mode: state.mode,
              message: text,
              question: state.question,
              topic: state.topic ?? 'other',
              horizon: state.horizon,
              reading: buildReading(state, now),
            },
          },
        ],
      };
    }

    default:
      return { state, steps: [] };
  }
}

function initialStateWith(state) {
  return { ...initialState(), birth: state.birth, readings: state.readings };
}

/** A fresh question, looked at the same way as the last. */
function keepMode(state) {
  return { ...initialStateWith(state), mode: state.mode };
}

function withProfile(result, birth) {
  return { ...result, steps: [{ type: 'profile', birth }, ...result.steps] };
}
