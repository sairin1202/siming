import { openDatabase } from '../../../lib/database.mjs';

export async function GET() {
  let connection;
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (process.env.DEPLOYMENT_ID) {
    headers.set('X-Deployment-Id', process.env.DEPLOYMENT_ID);
  }
  try {
    connection = await openDatabase();
    await connection.query('SELECT 1');
    return Response.json({ status: 'ok' }, { headers });
  } catch {
    return Response.json(
      { status: 'unavailable' },
      {
        status: 503,
        headers,
      },
    );
  } finally {
    await connection?.end().catch(() => {});
  }
}
