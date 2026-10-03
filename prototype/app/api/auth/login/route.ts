import { clientIp, maskPhone, normalizeCode, normalizePhone, sessionCookie } from '@/lib/auth.mjs';
import { checkVerifyCode } from '@/lib/aliyun-sms.mjs';
import { clearVerifyFails, createSession, getDb, logAuthEvent, verifyBlocked } from '@/lib/db.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

/** 用手机号和验证码登录；首次登录即注册。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJsonBody(request, 1_000)) as { phone?: unknown; code?: unknown };
    const phone = normalizePhone(body?.phone);
    const code = normalizeCode(body?.code);
    const db = getDb();
    if (verifyBlocked(db, phone)) throw new RequestError(429, '错误次数太多，请十分钟后再试。');
    if (!(await checkVerifyCode(phone, code))) {
      logAuthEvent(db, 'verify_fail', phone, clientIp(request));
      throw new RequestError(400, '验证码不对或已过期。');
    }
    clearVerifyFails(db, phone);
    const session = createSession(db, phone);
    return Response.json(
      { user: { phone: maskPhone(session.user.phone) } },
      { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(request, session.token) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
