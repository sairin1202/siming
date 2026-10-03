import { getBirth, setBirth } from './db.mjs';
import { isBirthComplete, sanitizeBirth } from './guide.mjs';

/** 校验后的完整生辰，不完整或无效返回 null。 */
export function completeBirth(raw) {
  const birth = sanitizeBirth(raw);
  return isBirthComplete(birth) ? birth : null;
}

/** 账号所存的生辰，已校验。 */
export function accountBirth(db, userId) {
  return completeBirth(getBirth(db, userId));
}

/** 为账号记下生辰；无效则不存，返回 false。 */
export function keepBirth(db, userId, raw) {
  const birth = completeBirth(raw);
  if (!birth) return false;
  setBirth(db, userId, birth);
  return true;
}
