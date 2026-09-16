import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCharacterState } from './character-state.mjs';

test('resolveCharacterState follows the live reply lifecycle', () => {
  const base = {
    verdict: null,
    activeRole: null,
    isReceiving: false,
    lastSpeaker: null,
  };

  assert.equal(resolveCharacterState({ ...base, role: 'angel' }), 'idle');
  assert.equal(
    resolveCharacterState({ ...base, role: 'angel', activeRole: 'angel' }),
    'thinking',
  );
  assert.equal(
    resolveCharacterState({ ...base, role: 'devil', activeRole: 'angel' }),
    'listening',
  );
  assert.equal(
    resolveCharacterState({
      ...base,
      role: 'angel',
      activeRole: 'angel',
      isReceiving: true,
    }),
    'speaking',
  );
  assert.equal(
    resolveCharacterState({ ...base, role: 'angel', lastSpeaker: 'angel' }),
    'speaking',
  );
});

test('resolveCharacterState gives verdict states the highest priority', () => {
  assert.equal(
    resolveCharacterState({
      role: 'angel',
      verdict: 'yes',
      activeRole: 'devil',
      isReceiving: true,
      lastSpeaker: 'devil',
    }),
    'victory',
  );
  assert.equal(
    resolveCharacterState({
      role: 'devil',
      verdict: 'yes',
      activeRole: 'devil',
      isReceiving: true,
      lastSpeaker: 'devil',
    }),
    'defeat',
  );
});
