import { clientIp, normalizeEmail } from '@/lib/auth.mjs';
import { CODE_MINUTES, getDb, issueLoginCode, logAuthEvent, sendBlockedReason } from '@/lib/db.mjs';
import { sendLoginCode } from '@/lib/mailer.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

const RESEND_SECONDS = 60;

/** 向邮箱发送登录验证码。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJsonBody(request, 1_000)) as { email?: unknown };
    const email = normalizeEmail(body?.email);
    const ip = clientIp(request);
    const db = getDb();
    const blocked = sendBlockedReason(db, email, ip);
    if (blocked) throw new RequestError(429, blocked);
    // 先记一次，发信失败也算，避免反复触发发信。
    logAuthEvent(db, 'send', email, ip);
    await sendLoginCode(email, issueLoginCode(db, email), CODE_MINUTES);
    return Response.json({ ok: true, resendAfter: RESEND_SECONDS }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
