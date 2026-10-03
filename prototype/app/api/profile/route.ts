import { requireUser } from '@/lib/auth.mjs';
import { getDb, setBirth } from '@/lib/db.mjs';
import { keepBirth } from '@/lib/profile.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** 为账号记下生辰：{ birth }。用于登录后把本机旧生辰并入账号。 */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const body = (await readJsonBody(request, 1_000)) as { birth?: unknown };
    if (!keepBirth(getDb(), user.id, body?.birth)) throw new RequestError(400, '生辰不全。');
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 忘却账号所存的生辰。 */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    setBirth(getDb(), user.id, null);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
