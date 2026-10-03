import { currentUser, maskPhone } from '@/lib/auth.mjs';
import { errorResponse } from '@/lib/request.mjs';

export async function GET(request: Request) {
  try {
    const user = currentUser(request);
    return Response.json(
      { user: user ? { phone: maskPhone(user.phone) } : null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
