import { currentUser, maskEmail } from '@/lib/auth.mjs';
import { errorResponse } from '@/lib/request.mjs';

export async function GET(request: Request) {
  try {
    const user = currentUser(request);
    return Response.json(
      { user: user ? { email: maskEmail(user.email) } : null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
