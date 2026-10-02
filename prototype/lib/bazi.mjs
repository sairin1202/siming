import lunar from 'lunar-javascript';

const { Solar } = lunar;

export const STEMS = '甲乙丙丁戊己庚辛壬癸';
export const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
export const ELEMENTS = ['木', '火', '土', '金', '水'];

// Hidden stems per branch, main qi first.
const HIDDEN_STEMS = {
  子: '癸',
  丑: '己癸辛',
  寅: '甲丙戊',
  卯: '乙',
  辰: '戊乙癸',
  巳: '丙庚戊',
  午: '丁己',
  未: '己丁乙',
  申: '庚壬戊',
  酉: '辛',
  戌: '戊辛丁',
  亥: '壬甲',
};
const HIDDEN_WEIGHTS = [1, 0.5, 0.3];
const MONTH_BRANCH_BONUS = 1;

// Ten-god group, as the element offset from the day master (生 = +1, 克 = +2).
const GROUP_OFFSET = { 比劫: 0, 食伤: 1, 财: 2, 官杀: 3, 印: 4 };
const SHISHEN_NAMES = {
  0: ['比肩', '劫财'],
  1: ['食神', '伤官'],
  2: ['偏财', '正财'],
  3: ['七杀', '正官'],
  4: ['偏印', '正印'],
};

export const TOPICS = ['career', 'wealth', 'study', 'create', 'peer', 'love', 'other'];

const LAYER_WEIGHTS = { natal: 0.2, dayun: 0.25, liunian: 0.3, liuyue: 0.25 };
const LAYER_LABELS = { dayun: '大运', liunian: '流年', liuyue: '流月' };

export const LEAN_THRESHOLDS = { waitGap: 15, go: 50 };

export class BaziInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BaziInputError';
  }
}

const stemElement = (stem) => Math.floor(STEMS.indexOf(stem) / 2);
const stemYin = (stem) => STEMS.indexOf(stem) % 2;
const branchElement = (branch) => stemElement(HIDDEN_STEMS[branch][0]);
const elementName = (element) => ELEMENTS[element];

/** Ten god of `stem` relative to the day master. */
export function shishenOf(dayStem, stem) {
  const offset = (stemElement(stem) - stemElement(dayStem) + 5) % 5;
  const differentPolarity = stemYin(stem) === stemYin(dayStem) ? 0 : 1;
  return SHISHEN_NAMES[offset][differentPolarity];
}

const isClash = (a, b) =>
  (BRANCHES.indexOf(a) - BRANCHES.indexOf(b) + 12) % 12 === 6;
const isSixHarmony = (a, b) =>
  (BRANCHES.indexOf(a) + BRANCHES.indexOf(b)) % 12 === 1;

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) throw new BaziInputError('出生日期格式应为 YYYY-MM-DD。');
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || year < 1900 || year > 2100) {
    throw new BaziInputError('出生日期无效。');
  }
  return { year, month, day };
}

function parseTime(value) {
  if (value == null) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new BaziInputError('出生时间格式应为 HH:MM。');
  const [hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) throw new BaziInputError('出生时间无效。');
  return { hour, minute };
}

/**
 * Local mean solar time: 4 minutes per degree of longitude from 120°E.
 * The equation of time (±16 min) is intentionally ignored.
 */
function toSolar({ year, month, day }, time, longitude) {
  if (!time) return Solar.fromYmdHms(year, month, day, 12, 0, 0);
  const offset =
    typeof longitude === 'number' ? Math.round((longitude - 120) * 4) : 0;
  const base = Date.UTC(year, month - 1, day, time.hour, time.minute);
  const shifted = new Date(base + offset * 60_000);
  return Solar.fromYmdHms(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    0,
  );
}

function elementStrength(pillars) {
  const totals = [0, 0, 0, 0, 0];
  pillars.forEach(({ stem, branch }, index) => {
    totals[stemElement(stem)] += 1;
    [...HIDDEN_STEMS[branch]].forEach((hidden, rank) => {
      const bonus = index === 1 && rank === 0 ? MONTH_BRANCH_BONUS : 0;
      totals[stemElement(hidden)] += HIDDEN_WEIGHTS[rank] + bonus;
    });
  });
  return totals.map((value) => Math.round(value * 10) / 10);
}

/**
 * Build a natal chart from birth data.
 * @param {{ date: string, time?: string | null, longitude?: number | null, gender: 'male' | 'female' }} input
 */
export function buildChart(input) {
  const date = parseDate(input?.date);
  const time = parseTime(input?.time ?? null);
  if (input.gender !== 'male' && input.gender !== 'female') {
    throw new BaziInputError('性别应为 male 或 female。');
  }
  const longitude =
    typeof input.longitude === 'number' && Number.isFinite(input.longitude)
      ? input.longitude
      : null;

  const solar = toSolar(date, time, longitude);
  const eightChar = solar.getLunar().getEightChar();
  const pillars = [
    [eightChar.getYearGan(), eightChar.getYearZhi()],
    [eightChar.getMonthGan(), eightChar.getMonthZhi()],
    [eightChar.getDayGan(), eightChar.getDayZhi()],
  ];
  if (time) pillars.push([eightChar.getTimeGan(), eightChar.getTimeZhi()]);
  const [year, month, day, hour = null] = pillars.map(([stem, branch]) => ({
    stem,
    branch,
  }));

  const dayStem = day.stem;
  const dayElement = stemElement(dayStem);
  const elements = elementStrength(pillars.map(([stem, branch]) => ({ stem, branch })));
  const total = elements.reduce((sum, value) => sum + value, 0);
  const support =
    elements[dayElement] + elements[(dayElement + 4) % 5];
  const ratio = support / total;
  const strong = ratio >= 0.5;

  // Simplified 扶抑: strong charts favour output, wealth and authority;
  // weak charts favour peers and resource.
  const favorableGroups = strong ? ['食伤', '财', '官杀'] : ['比劫', '印'];
  const favorable = favorableGroups.map(
    (group) => (dayElement + GROUP_OFFSET[group]) % 5,
  );

  const yun = eightChar.getYun(input.gender === 'male' ? 1 : 0);
  const dayun = yun
    .getDaYun()
    .filter((item) => item.getGanZhi())
    .map((item) => ({
      ganzhi: item.getGanZhi(),
      startYear: item.getStartYear(),
      startAge: item.getStartAge(),
    }));

  return {
    input: {
      date: input.date,
      time: time ? input.time : null,
      longitude,
      gender: input.gender,
    },
    solarTime: solar.toYmdHms(),
    pillars: { year, month, day, hour },
    hourKnown: Boolean(time),
    dayMaster: { stem: dayStem, element: elementName(dayElement) },
    elements: Object.fromEntries(
      elements.map((value, index) => [elementName(index), value]),
    ),
    strength: {
      ratio: Math.round(ratio * 100) / 100,
      label: ratio >= 0.6 ? '偏强' : ratio >= 0.5 ? '中和偏强' : ratio >= 0.4 ? '中和偏弱' : '偏弱',
      strong,
    },
    favorable: favorable.map(elementName),
    unfavorable: [0, 1, 2, 3, 4]
      .filter((element) => !favorable.includes(element))
      .map(elementName),
    dayun,
  };
}

function topicGroups(topic, gender) {
  switch (topic) {
    case 'career':
      return ['官杀'];
    case 'wealth':
      return ['财'];
    case 'study':
      return ['印'];
    case 'create':
      return ['食伤'];
    case 'peer':
      return ['比劫'];
    case 'love':
      return [gender === 'male' ? '财' : '官杀'];
    case 'other':
      return [];
    default:
      throw new BaziInputError(`未知的事情类型：${topic}`);
  }
}

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

function effectOf(raw) {
  if (raw > 0.5) return 'favorable';
  if (raw < -0.5) return 'unfavorable';
  return 'neutral';
}

function chartContext(chart) {
  const dayElement = ELEMENTS.indexOf(chart.dayMaster.element);
  return {
    dayStem: chart.dayMaster.stem,
    dayBranch: chart.pillars.day.branch,
    dayElement,
    favorable: chart.favorable.map((name) => ELEMENTS.indexOf(name)),
  };
}

function evaluateNatal(chart, context, groups) {
  if (groups.length === 0) {
    return {
      effect: 'neutral',
      score: 50,
      notes: [`日主${chart.dayMaster.stem}${chart.dayMaster.element}，${chart.strength.label}`],
      pros: [],
      cons: [],
    };
  }

  const natalPillars = Object.entries(chart.pillars).filter(([, pillar]) => pillar);
  const otherStems = natalPillars
    .filter(([key]) => key !== 'day')
    .map(([, pillar]) => pillar.stem);
  const hidden = natalPillars.flatMap(([, pillar]) => [...HIDDEN_STEMS[pillar.branch]]);

  let score = 50;
  const pros = [];
  const cons = [];
  for (const group of groups) {
    const element = (context.dayElement + GROUP_OFFSET[group]) % 5;
    const label = `${group}（${elementName(element)}）`;
    const revealed = otherStems.some((stem) => stemElement(stem) === element);
    const rooted = hidden.some((stem) => stemElement(stem) === element);
    const isFavorable = context.favorable.includes(element);

    if (revealed) score += 12;
    if (rooted) score += 8;
    if (!revealed && !rooted) {
      score -= 10;
      cons.push(`原局${label}不显，这类事需要外力引动`);
    } else if (revealed && rooted) {
      pros.push(`原局${label}透干有根，这类事有根基`);
    } else if (revealed) {
      pros.push(`原局${label}透干，有显露的机会`);
    } else {
      pros.push(`原局${label}藏于地支，潜力在内`);
    }

    if (isFavorable) {
      score += 12;
      pros.push(`${label}为喜用，做这类事顺你的性子`);
    } else {
      score -= 12;
      cons.push(`${label}非喜用，做这类事容易耗神`);
    }
  }

  score = clampScore(score);
  return {
    effect: score >= 60 ? 'favorable' : score <= 40 ? 'unfavorable' : 'neutral',
    score,
    notes: [...pros, ...cons],
    pros,
    cons,
  };
}

function evaluatePillar(label, ganzhi, context, groups) {
  const stem = ganzhi[0];
  const branch = ganzhi[1];
  const stemEl = stemElement(stem);
  const branchEl = branchElement(branch);
  let raw = 0;
  const pros = [];
  const cons = [];

  if (context.favorable.includes(stemEl)) {
    raw += 1;
    pros.push(`${label}${ganzhi}，天干${elementName(stemEl)}为喜用`);
  } else {
    raw -= 1;
    cons.push(`${label}${ganzhi}，天干${elementName(stemEl)}非喜用`);
  }
  if (context.favorable.includes(branchEl)) {
    raw += 1.2;
    if (branchEl !== stemEl) pros.push(`${label}地支${branch}${elementName(branchEl)}为喜用`);
  } else {
    raw -= 1.2;
    if (branchEl !== stemEl) cons.push(`${label}地支${branch}${elementName(branchEl)}非喜用`);
  }

  if (isClash(branch, context.dayBranch)) {
    raw -= 1;
    cons.push(`${label}${branch}冲日支${context.dayBranch}，计划易被打乱`);
  } else if (isSixHarmony(branch, context.dayBranch)) {
    raw += 0.5;
    pros.push(`${label}${branch}合日支${context.dayBranch}，易得助力`);
  }

  for (const group of groups) {
    const element = (context.dayElement + GROUP_OFFSET[group]) % 5;
    if (stemEl !== element && branchEl !== element) continue;
    if (context.favorable.includes(element)) {
      raw += 1;
      pros.push(`${label}引动${group}，且为喜用，这件事被推了一把`);
    } else {
      raw -= 0.5;
      cons.push(`${label}引动${group}，但非喜用，事起而多波折`);
    }
  }

  return {
    ganzhi,
    effect: effectOf(raw),
    score: clampScore(50 + raw * 12),
    notes: [...pros, ...cons],
    pros,
    cons,
  };
}

function currentDayun(chart, year) {
  let active = null;
  for (const item of chart.dayun) {
    if (item.startYear <= year) active = item;
  }
  return active;
}

function toSolarDate(date) {
  return Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Deterministic decision signal for one topic at one date.
 * @param {ReturnType<typeof buildChart>} chart
 * @param {string} topic
 * @param {Date} date
 */
export function computeSignal(chart, topic, date) {
  const groups = topicGroups(topic, chart.input.gender);
  const context = chartContext(chart);
  const lunarDate = toSolarDate(date).getLunar();

  const natal = evaluateNatal(chart, context, groups);
  const dayunItem = currentDayun(chart, date.getFullYear());
  const layers = {
    dayun: dayunItem
      ? evaluatePillar(LAYER_LABELS.dayun, dayunItem.ganzhi, context, groups)
      : null,
    liunian: evaluatePillar(
      LAYER_LABELS.liunian,
      lunarDate.getYearInGanZhiByLiChun(),
      context,
      groups,
    ),
    liuyue: evaluatePillar(
      LAYER_LABELS.liuyue,
      lunarDate.getMonthInGanZhiExact(),
      context,
      groups,
    ),
  };

  let weighted = natal.score * LAYER_WEIGHTS.natal;
  let weight = LAYER_WEIGHTS.natal;
  for (const [key, layer] of Object.entries(layers)) {
    if (!layer) continue;
    weighted += layer.score * LAYER_WEIGHTS[key];
    weight += LAYER_WEIGHTS[key];
  }

  const all = [natal, ...Object.values(layers).filter(Boolean)];
  return {
    topic,
    groups,
    date: toSolarDate(date).toYmd(),
    natal,
    ...layers,
    score: clampScore(weighted / weight),
    pros: all.flatMap((layer) => layer.pros),
    cons: all.flatMap((layer) => layer.cons),
  };
}

/**
 * Score each month in the horizon. The first entry uses `from` itself;
 * later entries sample the 20th, which sits inside the solar-term month.
 * @param {ReturnType<typeof buildChart>} chart
 * @param {string} topic
 * @param {Date} from
 * @param {number} months
 */
export function computeTiming(chart, topic, from, months) {
  const points = [];
  for (let index = 0; index < months; index += 1) {
    const sample =
      index === 0
        ? from
        : new Date(from.getFullYear(), from.getMonth() + index, 20);
    const signal = computeSignal(chart, topic, sample);
    points.push({
      month: `${sample.getFullYear()}-${String(sample.getMonth() + 1).padStart(2, '0')}`,
      ganzhi: signal.liuyue.ganzhi,
      score: signal.score,
    });
  }
  const best = points.reduce((top, point) => (point.score > top.score ? point : top));
  return { points, best };
}

/** @param {ReturnType<typeof computeTiming>} timing */
export function computeLean(timing) {
  const current = timing.points[0];
  if (timing.best.score - current.score >= LEAN_THRESHOLDS.waitGap) {
    return { lean: 'wait', until: timing.best.month, score: current.score };
  }
  if (current.score >= LEAN_THRESHOLDS.go) {
    return { lean: 'go', until: null, score: current.score };
  }
  return { lean: 'stop', until: null, score: current.score };
}

/**
 * Pick auspicious days for acting, spaced at least `minGap` days apart.
 * @param {ReturnType<typeof buildChart>} chart
 * @param {{ from: Date, days: number }} window
 * @param {number} count
 */
export function pickAuspiciousDays(chart, window, count = 3, minGap = 3) {
  const context = chartContext(chart);
  const candidates = [];

  for (let offset = 0; offset < window.days; offset += 1) {
    const date = new Date(
      window.from.getFullYear(),
      window.from.getMonth(),
      window.from.getDate() + offset,
    );
    const lunarDate = toSolarDate(date).getLunar();
    const ganzhi = lunarDate.getDayInGanZhi();
    const [stem, branch] = ganzhi;
    const monthBranch = lunarDate.getMonthZhiExact();
    const yearBranch = lunarDate.getYearZhiByLiChun();

    if (isClash(branch, context.dayBranch)) continue;
    if (isClash(branch, monthBranch) || isClash(branch, yearBranch)) continue;

    const stemFavorable = context.favorable.includes(stemElement(stem));
    const branchFavorable = context.favorable.includes(branchElement(branch));
    if (!stemFavorable && !branchFavorable) continue;

    const reasons = [];
    let score = 0;
    if (stemFavorable) {
      score += 1;
      reasons.push(`日干${stem}${elementName(stemElement(stem))}为喜用`);
    }
    if (branchFavorable) {
      score += 1;
      reasons.push(`日支${branch}${elementName(branchElement(branch))}为喜用`);
    }
    if (isSixHarmony(branch, context.dayBranch)) {
      score += 0.5;
      reasons.push(`${branch}合日支${context.dayBranch}`);
    }
    candidates.push({ date: toSolarDate(date).toYmd(), offset, ganzhi, score, reasons });
  }

  const picked = [];
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.offset - b.offset);
  for (const candidate of ranked) {
    if (picked.some((item) => Math.abs(item.offset - candidate.offset) < minGap)) continue;
    picked.push(candidate);
    if (picked.length === count) break;
  }

  return picked
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset: _offset, ...day }) => day);
}
