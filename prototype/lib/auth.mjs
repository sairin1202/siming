import { SESSION_DAYS, getDb, userForToken } from './db.mjs';
import { RequestError } from './request.mjs';

export const SESSION_COOKIE = 'siming_sid';

/** 邮箱：去掉首尾空白并转小写，按常见格式校验。 */
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new RequestError(400, '请输入邮箱。');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) {
    throw new RequestError(400, '请输入正确的邮箱。');
  }
  return email;
}

/** 只露出开头一两个字符和域名，如 ab***@qq.com。 */
export function maskEmail(email) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, name.length > 2 ? 2 : 1)}***@${domain}`;
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

/** 经可信代理（VINEXT_TRUST_PROXY=1）时以转发的协议为准。 */
function isHttps(request) {
  if (process.env.VINEXT_TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
    if (forwarded) return forwarded === 'https';
  }
  return new URL(request.url).protocol === 'https:';
}

export function sessionCookie(request, token) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(isHttps(request) ? ['Secure'] : [])];
  return token
    ? [`${SESSION_COOKIE}=${token}`, `Max-Age=${SESSION_DAYS * 86_400}`, ...attributes].join('; ')
    : [`${SESSION_COOKIE}=`, 'Max-Age=0', ...attributes].join('; ');
}

/** 当前登录用户，未登录返回 null。 */
export function currentUser(request, db = getDb()) {
  return userForToken(db, readCookie(request, SESSION_COOKIE));
}

export function requireUser(request, db = getDb()) {
  const user = currentUser(request, db);
  if (!user) throw new RequestError(401, '请先登录。');
  return user;
}

/** 客户端 IP；经可信代理时取代理追加的最后一跳。 */
export function clientIp(request) {
  if (process.env.VINEXT_TRUST_PROXY === '1') {
    const hops = request.headers.get('x-forwarded-for')?.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops?.length) return hops.at(-1);
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
