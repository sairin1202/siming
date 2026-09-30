import { loadDecisionHistory } from './history.mjs';

const IMPORTED_KEY = 'angel-devil:mysql-history-imported';

async function historyRequest(fetcher, options) {
  const response = await fetcher('/api/history', {
    cache: 'no-store',
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '暂时无法同步对话记录。');
  return payload;
}

export function saveDatabaseHistory(update, fetcher = fetch) {
  return historyRequest(fetcher, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
}

export async function loadDatabaseHistory(storage, fetcher = fetch) {
  // GET establishes the HttpOnly session before any concurrent writes begin.
  let remote = await historyRequest(fetcher);
  let imported = false;
  try {
    imported = storage.getItem(IMPORTED_KEY) === '1';
  } catch {
    /* Storage may be unavailable. */
  }
  if (!imported) {
    const local = loadDecisionHistory(storage);
    const remoteIds = new Set(remote.decisions.map((decision) => decision.id));
    for (const decision of local.decisions) {
      if (remoteIds.has(decision.id)) continue;
      await saveDatabaseHistory(
        { decision, currentDecisionId: remote.currentDecisionId },
        fetcher,
      );
    }
    if (!remote.currentDecisionId && local.currentDecisionId) {
      await saveDatabaseHistory(
        { decision: null, currentDecisionId: local.currentDecisionId },
        fetcher,
      );
    }
    try {
      storage.setItem(IMPORTED_KEY, '1');
    } catch {
      /* Database history still works without local storage. */
    }
    remote = await historyRequest(fetcher);
  }
  return remote;
}
