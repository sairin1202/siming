import assert from 'node:assert/strict';
import test from 'node:test';

import { castHexagram, hexagramByNumber, parseTosses, tossCoins } from './gua.mjs';
import ZHOUYI from './zhouyi.json' with { type: 'json' };

const texts = (cast) => cast.reading.map((item) => `${item.from}${item.hexagram}${item.label}`);

test('the data holds all 64 hexagrams with six lines each', () => {
  assert.equal(ZHOUYI.hexagrams.length, 64);
  assert.equal(new Set(ZHOUYI.hexagrams.map((item) => item.lines.join(''))).size, 64);
  for (const hexagram of ZHOUYI.hexagrams) {
    assert.equal(hexagram.yao.length, 6, hexagram.name);
    assert.ok(hexagram.judgment, hexagram.name);
  }
  assert.equal(hexagramByNumber(1).name, '乾');
  assert.equal(hexagramByNumber(64).name, '未济');
});

test('no changing lines: read the judgment', () => {
  const cast = castHexagram([7, 7, 7, 7, 7, 7]);
  assert.equal(cast.present.name, '乾');
  assert.equal(cast.future, null);
  assert.deepEqual(texts(cast), ['本卦乾卦辞']);
  assert.equal(cast.reading[0].text, '元亨。利贞。');
});

test('one changing line: read that line', () => {
  const cast = castHexagram([9, 7, 7, 7, 7, 7]);
  assert.equal(cast.future.name, '姤');
  assert.deepEqual(texts(cast), ['本卦乾初九']);
  assert.equal(cast.reading[0].text, '潜龙勿用。');
});

test('two changing lines: both, the upper first', () => {
  const cast = castHexagram([9, 9, 7, 7, 7, 7]);
  assert.deepEqual(texts(cast), ['本卦乾九二', '本卦乾初九']);
});

test('three changing lines: both judgments, the present first', () => {
  const cast = castHexagram([9, 9, 9, 7, 7, 7]);
  assert.equal(cast.future.name, '否');
  assert.deepEqual(texts(cast), ['本卦乾卦辞', '之卦否卦辞']);
});

test('four changing lines: the future hexagram\'s two still lines, the lower first', () => {
  const cast = castHexagram([9, 9, 9, 9, 7, 7]);
  assert.equal(cast.future.name, '观');
  assert.deepEqual(texts(cast), ['之卦观九五', '之卦观上九']);
});

test('five changing lines: the future hexagram\'s one still line', () => {
  const cast = castHexagram([9, 9, 9, 9, 9, 7]);
  // 乾 with its lower five lines changing becomes 剥 (one yang line on top).
  assert.equal(cast.future.name, '剥');
  assert.deepEqual(texts(cast), ['之卦剥上九']);
});

test('six changing lines: 用九 / 用六 for 乾 and 坤, otherwise the future judgment', () => {
  assert.deepEqual(texts(castHexagram([9, 9, 9, 9, 9, 9])), ['本卦乾用九']);
  assert.deepEqual(texts(castHexagram([6, 6, 6, 6, 6, 6])), ['本卦坤用六']);
  // 泰 (heaven below, earth above) turning wholly becomes 否.
  const cast = castHexagram([9, 9, 9, 6, 6, 6]);
  assert.equal(cast.present.name, '泰');
  assert.deepEqual(texts(cast), ['之卦否卦辞']);
});

test('coins and tosses are checked', () => {
  for (let index = 0; index < 200; index += 1) {
    const { coins, value } = tossCoins();
    assert.equal(coins.length, 3);
    assert.ok([6, 7, 8, 9].includes(value));
  }
  assert.deepEqual(parseTosses([6, 7, 8, 9, 7, 8]), [6, 7, 8, 9, 7, 8]);
  assert.equal(parseTosses([6, 7, 8, 9, 7]), null);
  assert.equal(parseTosses([5, 7, 8, 9, 7, 8]), null);
  assert.equal(parseTosses('678978'), null);
});
