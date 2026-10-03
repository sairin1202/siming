import { SESSION_COOKIE, readCookie, sessionCookie } from '@/lib/auth.mjs';
import { deleteSession, getDb } from '@/lib/db.mjs';
import { assertSameOrigin, errorResponse } from '@/lib/request.mjs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    deleteSession(getDb(), readCookie(request, SESSION_COOKIE));
    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(request, null) } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
