import { clientIp, maskEmail, normalizeEmail, sessionCookie } from '@/lib/auth.mjs';
import { clearLoginFails, createSession, findUserByEmail, getDb, logAuthEvent, loginBlocked } from '@/lib/db.mjs';
import { verifyPassword } from '@/lib/password.mjs';
import { accountBirth } from '@/lib/profile.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

/** 用邮箱和密码登录。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJsonBody(request, 1_000)) as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body?.email);
    if (typeof body?.password !== 'string' || !body.password) throw new RequestError(400, '请输入密码。');
    const ip = clientIp(request);
    const db = getDb();
    if (loginBlocked(db, email, ip)) throw new RequestError(429, '错误次数太多，请十五分钟后再试。');
    const user = findUserByEmail(db, email);
    // 邮箱不存在与密码错误给同样的回答。
    if (!(await verifyPassword(body.password, user?.passwordHash)) || !user) {
      logAuthEvent(db, 'login_fail', email, ip);
      throw new RequestError(400, '邮箱或密码不对。');
    }
    clearLoginFails(db, email);
    const session = createSession(db, user);
    return Response.json(
      { user: { email: maskEmail(email) }, birth: accountBirth(db, user.id) },
      { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(request, session.token) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
