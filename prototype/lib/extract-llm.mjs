// Reads birth details and the question out of a chat message with the model.
// The model only reports what was said; everything it returns is validated
// here, and lunar dates are converted locally with lunar-javascript, so a
// confused model can drop a field but never invent a wrong chart.

import lunar from 'lunar-javascript';

import { TOPICS } from './bazi.mjs';
import { looksLikeNonsense } from './extract.mjs';

const { Lunar } = lunar;

const HORIZONS = [1, 3, 6, 12];

const SYSTEM = `
你是一个信息提取器。阅读用户发给“司命”的一句话，参考司命上一句问了什么，只输出一个 JSON 对象，不要输出其他文字。
只提取用户明确说出的信息，没说的一律填 null，绝不猜测。

JSON 结构：
{
  "birth": {
    "calendar": "solar" | "lunar" | null,   // 用户说农历、阴历，或用了 正月 腊月 初八 廿三 这类说法时为 lunar
    "year": 整数 | null,                     // 四位年份；“九五年”即 1995，“03年”即 2003
    "month": 整数 | null,                    // 1-12；农历月份照原样填，不要换算成公历
    "day": 整数 | null,                      // 1-31；农历日期照原样填
    "leapMonth": true | false,               // 仅当用户说“闰几月”时为 true
    "time": "HH:MM" | "unknown" | null,      // 出生时间，24 小时制；时辰取中点（子时 00:00 丑时 02:00 寅时 04:00 卯时 06:00 辰时 08:00 巳时 10:00 午时 12:00 未时 14:00 申时 16:00 酉时 18:00 戌时 20:00 亥时 22:00）；用户说不记得、不知道时为 "unknown"
    "gender": "male" | "female" | null,
    "place": 字符串 | null,                  // 出生的城市或地区
    "longitude": 数字 | null                 // 出生地的大致东经度数，如杭州 120.2；不确定则为 null
  },
  "question": 字符串 | null,                 // 用户纠结的那件事，精简成一句，如“要不要辞职做自媒体”；没有新问题则为 null
  "topic": "career" | "wealth" | "study" | "create" | "peer" | "love" | "other" | null,
                                             // 事业、财、学业或置产、创业或表达、合伙或人际、感情、其他
  "horizonMonths": 1 | 3 | 6 | 12 | null,    // 用户想看的时间范围：这个月 1，三个月或一季 3，半年 6，今年或一年 12
  "confirmation": "yes" | "no" | null,       // 司命请用户确认时，用户表示对、是、确认为 yes；表示不对、要改为 no
  "isNewQuestion": true | false,             // 用户是否提出了一件新的、需要推演的事
  "meaningful": true | false                 // 这句话是否有可理解的意思。乱码、随手乱敲的字、毫无意义的字词堆砌、故意胡言乱语为 false；简短但真诚的话（如“辞职”“好的”“对”“不知道”）为 true
}
`.trim();

/**
 * Messages asking the model to read one user message.
 * @param {string} message
 * @param {{ phase: string, lastGuideLine: string | null, today: Date }} context
 */
export function buildExtractionMessages(message, { phase, lastGuideLine, today }) {
  const date = today.toISOString().slice(0, 10);
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: JSON.stringify({
        今天: date,
        对话阶段: phase,
        司命上一句: lastGuideLine ?? '',
        用户这句话: message,
      }),
    },
  ];
}

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Turn a birth date ({ calendar, year, month, day, leapMonth }) into a checked
 * solar YYYY-MM-DD, or null. Lunar dates are converted with lunar-javascript.
 */
export function solarDateOf(birth, now = new Date()) {
  if (!birth || !isInt(birth.year, 1900, now.getFullYear()) || !isInt(birth.month, 1, 12)) return null;
  if (!isInt(birth.day, 1, 31)) return null;
  let { year, month, day } = birth;
  if (birth.calendar === 'lunar') {
    if (day > 30) return null;
    try {
      const solar = Lunar.fromYmd(year, birth.leapMonth === true ? -month : month, day).getSolar();
      [year, month, day] = [solar.getYear(), solar.getMonth(), solar.getDay()];
    } catch {
      return null;
    }
  }
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date > now) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function birthTimeOf(time) {
  if (time === 'unknown') return null;
  if (typeof time !== 'string') return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${pad(match[1])}:${match[2]}`;
}

/**
 * Validate the model's JSON into the facts shape the guide uses (same as
 * extractFacts in extract.mjs). Returns null if the output isn't usable.
 * @param {unknown} raw
 * @param {string} message
 * @param {Date} now
 */
export function parseExtraction(raw, message, now = new Date()) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const birth = data.birth && typeof data.birth === 'object' ? data.birth : {};
  const place =
    typeof birth.place === 'string' && birth.place.trim() && birth.place.length <= 20
      ? {
          name: birth.place.trim(),
          longitude:
            typeof birth.longitude === 'number' && birth.longitude > 70 && birth.longitude < 140
              ? Math.round(birth.longitude * 10) / 10
              : null,
        }
      : null;
  const question =
    typeof data.question === 'string' && data.question.trim() ? data.question.trim().slice(0, 120) : null;
  const isNewQuestion = data.isNewQuestion === true;

  return {
    birthDate: solarDateOf(birth, now),
    birthTime: birthTimeOf(birth.time),
    gender: birth.gender === 'male' || birth.gender === 'female' ? birth.gender : null,
    // A place without a longitude still shows on the birth card; it just isn't used for solar time.
    place,
    horizon: HORIZONS.includes(data.horizonMonths) ? data.horizonMonths : null,
    topic: TOPICS.includes(data.topic) ? data.topic : null,
    isQuestion: isNewQuestion || question !== null,
    newQuestion: isNewQuestion,
    questionText: question ?? message.trim(),
    confirmation: data.confirmation === 'yes' ? true : data.confirmation === 'no' ? false : null,
    // Either reader can call it nonsense; the model's silence counts as sense.
    meaningful: data.meaningful !== false && !looksLikeNonsense(message),
  };
}
