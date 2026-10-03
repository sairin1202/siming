import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { RequestError } from './request.mjs';

/** 密码以 scrypt 加盐哈希保存：scrypt$N$r$p$salt$hash（base64）。 */

const scryptAsync = promisify(scrypt);
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function checkPassword(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) {
    throw new RequestError(400, `密码至少 ${PASSWORD_MIN} 位。`);
  }
  if (value.length > PASSWORD_MAX) throw new RequestError(400, `密码不能超过 ${PASSWORD_MAX} 位。`);
  return value;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// 邮箱不存在时也做一次同样耗时的计算，不让响应时间暴露邮箱是否注册。
const DUMMY = hashPassword('placeholder-password');

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = (stored ?? (await DUMMY)).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected) && stored !== null && stored !== undefined;
}
