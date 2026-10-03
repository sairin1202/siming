import { requireUser } from '@/lib/auth.mjs';
import { getDb, listRecords, sanitizeRecord, saveRecords, setOutcome } from '@/lib/db.mjs';
import { RequestError, assertSameOrigin, errorResponse, readJsonBody } from '@/lib/request.mjs';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** 当前用户的问事记录，新的在前。 */
export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return Response.json({ records: listRecords(getDb(), user.id) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 保存记录：{ records: [...] }。也用于登录后把本机旧记录并入账号。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const body = (await readJsonBody(request, 200_000)) as { records?: unknown };
    if (!Array.isArray(body?.records) || body.records.length > 50) throw new RequestError(400, '请求格式无效。');
    const records = body.records.map(sanitizeRecord).filter((record) => record !== null);
    const db = getDb();
    saveRecords(db, user.id, records);
    return Response.json({ records: listRecords(db, user.id) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 标记其后如何：{ id, outcome }。 */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const body = (await readJsonBody(request, 1_000)) as { id?: unknown; outcome?: unknown };
    if (typeof body?.id !== 'string') throw new RequestError(400, '请求格式无效。');
    if (!setOutcome(getDb(), user.id, body.id, body.outcome)) throw new RequestError(404, '找不到这条记录。');
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
