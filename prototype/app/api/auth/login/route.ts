import { maskEmail, normalizeCode, normalizeEmail, sessionCookie } from '@/lib/auth.mjs';
import { consumeLoginCode, createSession, getDb } from '@/lib/db.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

/** 用邮箱和验证码登录；首次登录即注册。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJsonBody(request, 1_000)) as { email?: unknown; code?: unknown };
    const email = normalizeEmail(body?.email);
    const code = normalizeCode(body?.code);
    const db = getDb();
    if (!consumeLoginCode(db, email, code)) throw new RequestError(400, '验证码不对或已过期。');
    const session = createSession(db, email);
    return Response.json(
      { user: { email: maskEmail(session.user.email) } },
      { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(request, session.token) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
