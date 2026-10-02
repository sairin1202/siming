// Builds lib/zhouyi.json: the 64 hexagrams of the Zhouyi with their judgment
// (卦辞), line texts (爻辞) and Great Image (大象), from the proofread
// public-domain text on Chinese Wikisource, converted to simplified Chinese.
//
//   node scripts/build-zhouyi.mjs
//   ZHOUYI_CACHE=/path/to/pages node scripts/build-zhouyi.mjs   # offline
//
// The output is committed; the app never fetches this at runtime.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as OpenCC from 'opencc-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = (title) => `https://zh.wikisource.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`;
const convert = OpenCC.Converter({ from: 'tw', to: 'cn' });
// Characters OpenCC must leave alone: 乾 (the hexagram, and 乾乾 "unceasing")
// would become 干, and 繻 / 纆 / 餗 would become rare forms most fonts lack.
const KEEP = /([乾繻纆餗])/;
const toSimplified = (text) =>
  text
    .split(KEEP)
    .map((part) => (KEEP.test(part) ? part : convert(part)))
    .join('');

// Wikisource marks variant readings as {{另|shown|alternative}}, and its
// shown text is not always the received one. Use the received reading of the
// Wang Bi text (通行本), as most readers know it.
const RECEIVED = {
  '庸|墉': '墉',
  '荼荼|徐徐': '徐徐',
  '蔾|藜': '藜',
  '轝|車': '車',
  '腹|輹': '輹',
  '轝|輿': '輿',
  '告|牿': '牿',
  '輹|腹': '輹',
  '得|德': '德',
  '車|輿': '輿',
  '輹|輻': '輻',
  '磐|盤': '磐',
  '震|振': '振',
  '祀|已': '已',
  '僮|童': '童',
  '國|邦': '國',
  '能|而': '能',
  '敺|驅': '驅',
  '孚|序': '序',
  '裂|列': '列',
  '閽|薰': '薰',
  '資|咨': '咨',
  '取|娶': '取',
  '褫|拕': '褫',
  '差|嗟': '嗟',
  '刑|形': '形',
  '德車|得輿': '得輿',
  '享|亨': '亨',
  '昔|臘': '臘',
  '蹢躅|𨅙𨄃': '蹢躅',
  '𧤊|掣': '掣',
  '墉|庸': '墉',
  '惟|維': '維',
  '它|他': '他',
  '既|几、幾': '幾',
  '佑|右': '佑',
  '尫|彭': '彭',
  '戠|簪': '簪',
  '拇|母': '拇',
  '尊酒簋，貳用缶。内約自牖|樽酒簋貳，用缶，納約自牖': '樽酒簋貳，用缶，納約自牖',
  '禔|祗': '祗',
  '鼫|碩': '鼫',
  '矢|失': '失',
};
// The same pair can need different readings in different hexagrams.
const RECEIVED_IN = {
  否: { '包|苞': '苞' }, // 系于苞桑
  姤: { '包|苞': '包' }, // 包有鱼
};

function resolveVariants(raw, title) {
  return raw.replace(/\{\{另\|([^|}]*)\|([^}]*)\}\}/g, (whole, shown, other) => {
    const key = `${shown}|${other}`;
    const reading = RECEIVED_IN[title]?.[key] ?? RECEIVED[key];
    if (!reading) throw new Error(`No received reading chosen for ${whole} in ${title}`);
    return reading;
  });
}

// Trigram name (traditional, as the pages write it) → lines from bottom to top (1 = yang).
const TRIGRAMS = {
  乾: [1, 1, 1],
  兌: [1, 1, 0],
  離: [1, 0, 1],
  震: [1, 0, 0],
  巽: [0, 1, 1],
  坎: [0, 1, 0],
  艮: [0, 0, 1],
  坤: [0, 0, 0],
};
const TRIGRAM_NATURE = { 乾: '天', 兌: '泽', 離: '火', 震: '雷', 巽: '风', 坎: '水', 艮: '山', 坤: '地' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Set ZHOUYI_CACHE to a folder of saved pages (<title>.txt) to build offline.
const CACHE = process.env.ZHOUYI_CACHE;

// curl rather than fetch: Node's fetch kept timing out against Wikisource here.
async function fetchText(title) {
  const cached = CACHE && join(CACHE, `${title.replace(/^周易\//, '')}.txt`);
  if (cached && existsSync(cached)) return readFileSync(cached, 'utf8');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return execFileSync('curl', ['-sSf', '--max-time', '30', '-A', 'siming-build/1.0 (zhouyi data build)', RAW(title)], {
        maxBuffer: 16 * 1024 * 1024,
      }).toString();
    } catch {
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`Could not fetch ${title}`);
}

/** Strip wiki markup: language-variant guards, spans, bold, inline templates. */
function clean(text) {
  return text
    .replace(/-\{([^}]*)\}-/g, '$1')
    .replace(/\{\{\*\|[^}]*\}\}/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''/g, '')
    .trim();
}

function parse(raw, number) {
  const lines = raw.split('\n');
  const trigramLine = lines.find((line) => /下.*上\s*$/.test(clean(line)));
  const match = /(\S)下(\S)上/.exec(clean(trigramLine ?? '').replace(/^.*\]\]\s*/, ''));
  if (!match) throw new Error(`No trigrams for hexagram ${number}`);
  const [, lower, upper] = match;

  // The classic text is in blue: judgment on a "**" line, line texts on "*#" lines.
  const blue = lines.filter((line) => line.includes('color:blue'));
  // The name is in bold. Usually "name：judgment", but a few judgments begin
  // with the name itself (履虎尾、否之匪人、同人于野、艮其背), with no colon.
  const judgmentRaw = (blue.find((line) => line.startsWith('**')) ?? '').replace(/-\{([^}]*)\}-/g, '$1');
  const bold = /'''([^']+)'''/.exec(judgmentRaw);
  const name = bold ? clean(bold[1]) : '';
  const rest = clean(judgmentRaw.slice((bold?.index ?? 0) + (bold?.[0].length ?? 0)));
  const judgment = rest.startsWith('：') ? rest.slice(1) : name + rest;
  const yao = blue
    .filter((line) => line.startsWith('*#'))
    .map((line) => clean(line.replace(/^\*#/, '')))
    .map((line) => {
      // Usually "初九：…", but a few pages write "初九，…".
      const parts = /^(初[六九]|[六九][二三四五]|上[六九]|用[六九])[：，](.*)$/.exec(line);
      if (!parts) throw new Error(`Unexpected line text in hexagram ${number}: ${line}`);
      return { label: parts[1], text: parts[2] };
    });

  // The Great Image: the first "**" line after "象曰：".
  const imageAt = lines.findIndex((line) => clean(line).startsWith('*象曰：'));
  const image = imageAt >= 0 ? clean(lines[imageAt + 1].replace(/^\*+/, '')) : '';

  if (!judgment || yao.length < 6) throw new Error(`Incomplete text for hexagram ${number} (${name})`);
  // Hexagram 29 is titled 習坎 in the text; its name is 坎, and 習坎 opens the judgment.
  const displayName = name === '習坎' ? '坎' : name;
  const fullJudgment = name === '習坎' ? `習坎，${judgment}` : judgment;
  return {
    number,
    name: toSimplified(displayName),
    upper: TRIGRAM_NATURE[upper],
    lower: TRIGRAM_NATURE[lower],
    // Bottom line first.
    lines: [...TRIGRAMS[lower], ...TRIGRAMS[upper]],
    judgment: toSimplified(fullJudgment),
    image: toSimplified(image),
    yao: yao.slice(0, 6).map((item) => ({ label: toSimplified(item.label), text: toSimplified(item.text) })),
    extra: yao[6] ? { label: toSimplified(yao[6].label), text: toSimplified(yao[6].text) } : null,
  };
}

const index = await fetchText('周易');
// The page lists the hexagrams twice; the second run is the King Wen order.
const links = [...index.matchAll(/\[\[\/([^\]|]+)/g)].map((match) => match[1]);
const order = links.slice(-64);
if (order[0] !== '乾' || order[1] !== '坤' || order.length !== 64) {
  throw new Error(`Unexpected hexagram order: ${order.slice(0, 4).join(' ')}`);
}

const hexagrams = [];
for (const [position, title] of order.entries()) {
  const raw = resolveVariants(await fetchText(`周易/${title}`), title);
  hexagrams.push(parse(raw, position + 1));
  process.stdout.write(`${position + 1} ${title}  `);
  await sleep(250);
}

const keys = new Set(hexagrams.map((item) => item.lines.join('')));
if (keys.size !== 64) throw new Error('Line patterns are not all distinct');

const output = join(ROOT, 'lib', 'zhouyi.json');
writeFileSync(
  output,
  `${JSON.stringify(
    {
      source: 'Zhouyi (周易), public domain; transcription from Chinese Wikisource, converted to simplified Chinese',
      hexagrams,
    },
    null,
    1,
  )}\n`,
);
console.log(`\nWrote ${hexagrams.length} hexagrams to ${output}`);
