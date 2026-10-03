import { clientIp, maskEmail, normalizeEmail, sessionCookie } from '@/lib/auth.mjs';
import { createSession, createUser, getDb, logAuthEvent, registerBlocked } from '@/lib/db.mjs';
import { checkPassword, hashPassword } from '@/lib/password.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

/** 用邮箱和密码注册，注册后直接登录。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJsonBody(request, 1_000)) as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body?.email);
    const password = checkPassword(body?.password);
    const ip = clientIp(request);
    const db = getDb();
    if (registerBlocked(db, ip)) throw new RequestError(429, '注册太频繁，请稍后再试。');
    const user = createUser(db, email, await hashPassword(password));
    if (!user) throw new RequestError(409, '此邮箱已注册，请直接登录。');
    logAuthEvent(db, 'register', email, ip);
    const session = createSession(db, user);
    return Response.json(
      { user: { email: maskEmail(email) }, birth: null },
      { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(request, session.token) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
