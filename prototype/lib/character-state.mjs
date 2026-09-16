/**
 * Resolve the pose shown for one character from the live debate lifecycle.
 * Verdicts override transient reply state, while the opposing character listens.
 */
export function resolveCharacterState({
  role,
  verdict,
  activeRole,
  isReceiving,
  lastSpeaker,
}) {
  if (verdict) {
    const winner = verdict === 'yes' ? 'angel' : 'devil';
    return winner === role ? 'victory' : 'defeat';
  }
  if (activeRole === role) return isReceiving ? 'speaking' : 'thinking';
  if (activeRole && activeRole !== role) return 'listening';
  if (lastSpeaker === role) return 'speaking';
  if (lastSpeaker && lastSpeaker !== role) return 'listening';
  return 'idle';
}
