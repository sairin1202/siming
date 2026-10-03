import { getDb } from '@/lib/db.mjs';

export async function GET() {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (process.env.DEPLOYMENT_ID) {
    headers.set('X-Deployment-Id', process.env.DEPLOYMENT_ID);
  }
  try {
    getDb().prepare('SELECT 1').get();
  } catch (error) {
    console.error('Database check failed:', (error as Error).message);
    return Response.json({ status: 'error', database: 'unavailable' }, { status: 503, headers });
  }
  return Response.json({ status: 'ok' }, { headers });
}
