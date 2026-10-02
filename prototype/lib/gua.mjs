// Casting a hexagram with three coins, and choosing which words of the
// Zhouyi speak to it. Pure functions; the coins are thrown in the browser and
// the result is checked and read here.

import ZHOUYI from './zhouyi.json' with { type: 'json' };

const BY_LINES = new Map(ZHOUYI.hexagrams.map((hexagram) => [hexagram.lines.join(''), hexagram]));
const BY_NUMBER = new Map(ZHOUYI.hexagrams.map((hexagram) => [hexagram.number, hexagram]));

/**
 * One throw of three coins: each heads counts 3, tails 2.
 * 6 old yin (changing), 7 young yang, 8 young yin, 9 old yang (changing).
 * @param {() => number} random returns [0, 1)
 */
export function tossCoins(random = Math.random) {
  const coins = [0, 1, 2].map(() => (random() < 0.5 ? 3 : 2));
  return { coins, value: coins.reduce((sum, coin) => sum + coin, 0) };
}

export const isChanging = (value) => value === 6 || value === 9;
const isYang = (value) => value === 7 || value === 9;

/** Validate six thrown values, bottom line first. */
export function parseTosses(raw) {
  if (!Array.isArray(raw) || raw.length !== 6) return null;
  return raw.every((value) => value === 6 || value === 7 || value === 8 || value === 9) ? [...raw] : null;
}

export function hexagramByNumber(number) {
  return BY_NUMBER.get(number) ?? null;
}

/**
 * The cast: the present hexagram (本卦), the one it turns into (之卦) when any
 * line is changing, and which texts to read (after Zhu Xi, 《易学启蒙》).
 * @param {number[]} tosses six values, bottom line first
 */
export function castHexagram(tosses) {
  const lines = tosses.map((value) => (isYang(value) ? 1 : 0));
  const changing = tosses.flatMap((value, index) => (isChanging(value) ? [index] : []));
  const present = BY_LINES.get(lines.join(''));
  const futureLines = lines.map((line, index) => (changing.includes(index) ? 1 - line : line));
  const future = changing.length ? BY_LINES.get(futureLines.join('')) : null;
  return { tosses, changing, present, future, reading: chooseTexts(present, future, changing) };
}

function lineText(hexagram, index, from) {
  const yao = hexagram.yao[index];
  return { from, hexagram: hexagram.name, label: yao.label, text: yao.text };
}

function judgmentText(hexagram, from) {
  return { from, hexagram: hexagram.name, label: '卦辞', text: hexagram.judgment };
}

/**
 * Which words answer the question, by the number of changing lines:
 * 0 — the present judgment; 1 — that line; 2 — both lines, the upper leads;
 * 3 — both judgments, the present leads; 4 — the two unchanged lines of the
 * future hexagram, the lower leads; 5 — its one unchanged line; 6 — 用九 /
 * 用六 for 乾 / 坤, otherwise the future judgment.
 */
export function chooseTexts(present, future, changing) {
  const count = changing.length;
  if (count === 0) return [judgmentText(present, '本卦')];
  if (count === 1) return [lineText(present, changing[0], '本卦')];
  if (count === 2) return [changing[1], changing[0]].map((index) => lineText(present, index, '本卦'));
  if (count === 3) return [judgmentText(present, '本卦'), judgmentText(future, '之卦')];
  const unchanged = [0, 1, 2, 3, 4, 5].filter((index) => !changing.includes(index));
  if (count === 4) return unchanged.map((index) => lineText(future, index, '之卦'));
  if (count === 5) return [lineText(future, unchanged[0], '之卦')];
  if (present.extra) return [{ from: '本卦', hexagram: present.name, label: present.extra.label, text: present.extra.text }];
  return [judgmentText(future, '之卦')];
}

