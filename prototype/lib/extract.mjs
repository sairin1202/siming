// Pulls birth data, topic and horizon out of casual Chinese chat messages.
// Works without a model so the guide can run offline; everything it reads
// is shown back to the user on the birth card before a chart is drawn.

import lunar from 'lunar-javascript';

import { CITIES } from './cities.mjs';

const { Lunar } = lunar;

const CN_DIGITS = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnNumber(text) {
  if (!text.includes('十')) return Number([...text].map((char) => CN_DIGITS[char]).join(''));
  const [tens, ones] = text.split('十');
  return (tens ? CN_DIGITS[tens] : 1) * 10 + (ones ? CN_DIGITS[ones] : 0);
}

/** Turn Chinese numerals into digits: 九五年三月初八 → 95年3月8. */
export function normalize(text) {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/([〇零一二三四五六七八九]{2,4})(?=年)/g, (run) =>
      [...run].map((char) => CN_DIGITS[char]).join(''),
    )
    .replace(/正月/g, '农历1月')
    .replace(/冬月/g, '农历11月')
    .replace(/腊月/g, '农历12月')
    .replace(/初([一二三四五六七八九十])/g, (_, run) => `初${cnNumber(run)}`)
    .replace(/廿([一二三四五六七八九])?/g, (_, run) => `初${20 + (run ? cnNumber(run) : 0)}`)
    .replace(/(\d{1,2}月)([一二三四五六七八九十]{1,3})/g, (_, month, run) => month + cnNumber(run))
    .replace(/([一二两三四五六七八九十]{1,3})(?=[月日号点时个])/g, (run) => String(cnNumber(run)));
}


export function findPlace(text) {
  const name = Object.keys(CITIES).find((city) => text.includes(city));
  return name ? { name, longitude: CITIES[name] } : null;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function findBirthDate(text, now = new Date()) {
  const match = /(\d{4}|\d{2})\s*[年./-]\s*(?:农历|阴历)?\s*(\d{1,2})\s*[月./-]\s*(?:初)?(\d{1,2})/.exec(text);
  if (!match) return null;
  let year = Number(match[1]);
  if (match[1].length === 2) {
    const century = year <= now.getFullYear() % 100 ? 2000 : 1900;
    year += century;
  }
  let month = Number(match[2]);
  let day = Number(match[3]);
  // 初八 / 廿三 / 农历 mean a lunar date; convert it to the solar calendar.
  if (/农历|阴历|旧历|初\d/.test(text)) {
    if (month < 1 || month > 12 || day < 1 || day > 30) return null;
    try {
      const solar = Lunar.fromYmd(year, month, day).getSolar();
      [year, month, day] = [solar.getYear(), solar.getMonth(), solar.getDay()];
    } catch {
      return null;
    }
  }
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date > now || year < 1900) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const SHICHEN_HOURS = { 子: 0, 丑: 2, 寅: 4, 卯: 6, 辰: 8, 巳: 10, 午: 12, 未: 14, 申: 16, 酉: 18, 戌: 20, 亥: 22 };
const UNKNOWN_TIME =
  /(?:不知道|不记得|不清楚|忘了|不确定)[^。]{0,6}(?:时辰|几点|时间)|(?:时辰|几点|时间)[^。]{0,6}(?:不知道|不记得|不清楚|忘了|不确定)/;

/** @returns {string | null | undefined} HH:MM, null when the user doesn't know, undefined when not mentioned. */
export function findBirthTime(text) {
  if (UNKNOWN_TIME.test(text)) return null;

  const clock = /(?:^|[^\d])(\d{1,2}):(\d{2})/.exec(text);
  if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60) {
    return `${pad(clock[1])}:${clock[2]}`;
  }

  const spoken =
    /(凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|半夜)?\s*(\d{1,2})\s*[点時](?:钟)?\s*(半|(\d{1,2})\s*分?)?/.exec(text);
  if (spoken) {
    let hour = Number(spoken[2]);
    const minute = spoken[3] === '半' ? 30 : Number(spoken[4] ?? 0);
    const period = spoken[1];
    if (['下午', '傍晚', '晚上'].includes(period) && hour < 12) hour += 12;
    if (period === '中午' && hour < 5) hour += 12;
    if (['半夜', '夜里'].includes(period) && hour === 12) hour = 0;
    if (['夜里'].includes(period) && hour >= 6 && hour < 12) hour += 12;
    if (hour < 24 && minute < 60) return `${pad(hour)}:${pad(minute)}`;
  }

  const shichen = /([子丑寅卯辰巳午未申酉戌亥])时/.exec(text);
  if (shichen) return `${pad(SHICHEN_HOURS[shichen[1]])}:00`;
  return undefined;
}

export function findGender(text) {
  const female = /(女生|女性|女的|女孩|女士|性别[:\s]*女|我是女|(?:^|[，,。\s])女(?:$|[，,。\s]))/.test(text);
  const male = /(男生|男性|男的|男孩|男士|性别[:\s]*男|我是男|(?:^|[，,。\s])男(?:$|[，,。\s]))/.test(text);
  if (female === male) return null;
  return female ? 'female' : 'male';
}

export function findHorizon(text) {
  if (/这个月|本月|一个月|1个月/.test(text)) return 1;
  if (/半年|6个月/.test(text)) return 6;
  if (/今年|年内|一年|12个月/.test(text)) return 12;
  if (/3个月|季度/.test(text)) return 3;
  return null;
}

const TOPIC_PATTERNS = [
  ['love', /表白|分手|复合|结婚|恋爱|对象|相亲|喜欢的人|在一起|离婚|男朋友|女朋友|求婚|异地/],
  ['peer', /合伙|朋友一起|和朋友|入股|搭档/],
  ['create', /创业|自媒体|博主|直播|开店|开公司|写书|作品|独立开发|自由职业/],
  ['study', /读研|考研|留学|考试|读博|进修|培训|证书|学习|买房|考证/],
  ['wealth', /投资|副业|理财|赚钱|加薪|薪资|工资|股票|基金|借钱|贷款|涨薪/],
  ['career', /工作|跳槽|offer|升职|职位|考公|入职|辞职|换工作|项目|老板|岗位|面试|公司/i],
];

export function findTopic(text) {
  const hit = TOPIC_PATTERNS.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : null;
}

const QUESTION_PATTERN = /要不要|该不该|能不能|是否|还是|应不应该|值不值得|可不可以|纠结|犹豫|打算|想要?|考虑|吗[？?]?$/;

export function looksLikeQuestion(text) {
  return QUESTION_PATTERN.test(text) || findTopic(text) !== null;
}

const KEYBOARD_RUN = /qwer|wert|erty|asdf|sdfg|dfgh|fghj|ghjk|hjkl|zxcv|xcvb|cvbn|vbnm|uiop|yuio/i;

/** Keyboard mashing, a lone sound, symbols or one word over and over: nothing to divine on. */
export function looksLikeNonsense(raw) {
  const text = raw.replace(/[\s\p{P}\p{S}]/gu, '');
  if ([...text].length < 2) return true;
  if (/^\d+$/.test(text)) return true;
  // 「哈哈」「呵呵呵」「asdasd」, but not a thank-you.
  if (/^(.{1,3})\1+$/u.test(text) && !/^(谢谢|多谢|拜拜)+$/.test(text)) return true;
  if (/^[a-z]+$/i.test(text) && text.length >= 4) {
    const vowels = (text.match(/[aeiou]/gi) ?? []).length;
    if (vowels / text.length < 0.2 || KEYBOARD_RUN.test(text)) return true;
  }
  return false;
}

/** The part of a message that is the question, without birth details. */
export function findQuestionText(raw) {
  const clauses = raw.split(/[，,。；;！!\n]/).map((clause) => clause.trim()).filter(Boolean);
  const start = clauses.findIndex((clause) => looksLikeQuestion(normalize(clause)));
  if (start === -1) return raw.trim();
  return clauses
    .slice(start)
    .join('，')
    .replace(/^(?:我)?(?:在|正在|一直)?(?:纠结|犹豫|想问|想知道|考虑)(?:一下)?/, '')
    .trim() || raw.trim();
}

export function findConfirmation(text) {
  const trimmed = text.trim();
  if (/^(不对|不是|错了|有误|改一下|要改)/.test(trimmed)) return false;
  if (/^(是|对|对的|没错|嗯|好|好的|确认|是的|没问题|ok|okay|yes)[。！!.\s]*$/i.test(trimmed)) return true;
  return null;
}

/**
 * Everything the guide can read from one message.
 * @param {string} raw
 * @param {Date} [now]
 */
export function extractFacts(raw, now = new Date()) {
  const text = normalize(raw);
  return {
    birthDate: findBirthDate(text, now),
    birthTime: findBirthTime(text),
    gender: findGender(text),
    place: findPlace(text),
    horizon: findHorizon(text),
    topic: findTopic(text),
    isQuestion: looksLikeQuestion(text),
    newQuestion: looksLikeQuestion(text) && /要不要|该不该|应不应该|值不值得|能不能/.test(text),
    questionText: findQuestionText(raw),
    confirmation: findConfirmation(text),
    meaningful: !looksLikeNonsense(raw),
  };
}
