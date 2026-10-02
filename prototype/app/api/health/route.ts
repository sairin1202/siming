export async function GET() {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (process.env.DEPLOYMENT_ID) {
    headers.set('X-Deployment-Id', process.env.DEPLOYMENT_ID);
  }
  return Response.json({ status: 'ok' }, { headers });
}
