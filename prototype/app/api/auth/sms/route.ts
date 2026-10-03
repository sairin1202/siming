import { clientIp, normalizePhone } from '@/lib/auth.mjs';
import { RESEND_SECONDS, sendVerifyCode } from '@/lib/aliyun-sms.mjs';
import { getDb, logAuthEvent, sendBlockedReason } from '@/lib/db.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

/** 发送登录验证码。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJsonBody(request, 1_000)) as { phone?: unknown };
    const phone = normalizePhone(body?.phone);
    const ip = clientIp(request);
    const db = getDb();
    const blocked = sendBlockedReason(db, phone, ip);
    if (blocked) throw new RequestError(429, blocked);
    // 先记一次，失败也算，避免反复触发阿里云调用。
    logAuthEvent(db, 'send', phone, ip);
    await sendVerifyCode(phone);
    return Response.json({ ok: true, resendAfter: RESEND_SECONDS }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
