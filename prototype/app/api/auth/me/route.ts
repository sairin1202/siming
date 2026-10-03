import { currentUser, maskEmail } from '@/lib/auth.mjs';
import { getDb } from '@/lib/db.mjs';
import { accountBirth } from '@/lib/profile.mjs';
import { errorResponse } from '@/lib/request.mjs';

export async function GET(request: Request) {
  try {
    const db = getDb();
    const user = currentUser(request, db);
    return Response.json(
      user ? { user: { email: maskEmail(user.email) }, birth: accountBirth(db, user.id) } : { user: null, birth: null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
