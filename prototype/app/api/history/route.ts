import {
  readHistory,
  saveHistoryUpdate,
  withDatabaseSession,
} from '@/lib/database.mjs';
import {
  assertSameOrigin,
  parseHistoryUpdate,
  persistenceErrorResponse,
  readJsonBody,
} from '@/lib/persistence.mjs';

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const result = await withDatabaseSession(request, readHistory);
    return Response.json(result.value, {
      headers: {
        'Cache-Control': 'no-store',
        ...(result.cookie ? { 'Set-Cookie': result.cookie } : {}),
      },
    });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const update = parseHistoryUpdate(await readJsonBody(request));
    const result = await withDatabaseSession(request, (connection, ownerId) =>
      saveHistoryUpdate(connection, ownerId, update),
    );
    return Response.json(
      { saved: true },
      {
        headers: {
          'Cache-Control': 'no-store',
          ...(result.cookie ? { 'Set-Cookie': result.cookie } : {}),
        },
      },
    );
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
