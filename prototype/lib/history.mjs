export const HISTORY_STORAGE_KEY = 'angel-devil:decision-history';

const HISTORY_VERSION = 1;
const INTERRUPTED_REPLY_MESSAGE = '上次会话在回复完成前关闭了，可以重试。';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function optionalString(value) {
  return typeof value === 'string' ? value : undefined;
}

function timestamp(value, fallback) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : fallback;
}

function sanitizeReply(rawReply, fallbackTime) {
  if (!isRecord(rawReply)) return null;
  const id = requiredString(rawReply.id);
  const role =
    rawReply.role === 'angel' || rawReply.role === 'devil'
      ? rawReply.role
      : null;
  if (!id || !role) return null;

  const wasStreaming = rawReply.status === 'streaming';
  const status = wasStreaming
    ? 'error'
    : rawReply.status === 'error'
      ? 'error'
      : 'complete';
  const content = optionalString(rawReply.content) || '';
  const safetyMode =
    rawReply.safetyMode === 'standard' ||
    rawReply.safetyMode === 'high_stakes' ||
    rawReply.safetyMode === 'crisis'
      ? rawReply.safetyMode
      : undefined;
  const savedError = isRecord(rawReply.error) ? rawReply.error : null;
  const error =
    status === 'error'
      ? {
          message: wasStreaming
            ? INTERRUPTED_REPLY_MESSAGE
            : optionalString(savedError?.message) || '这次回复中断了。',
          retryable: wasStreaming || savedError?.retryable === true,
        }
      : undefined;

  return {
    id,
    role,
    content,
    status,
    createdAt: timestamp(rawReply.createdAt, fallbackTime),
    ...(error ? { error } : {}),
    ...(safetyMode ? { safetyMode } : {}),
  };
}

function sanitizeTurn(rawTurn, fallbackTime) {
  if (!isRecord(rawTurn)) return null;
  const id = requiredString(rawTurn.id);
  const userMessage = requiredString(rawTurn.userMessage);
  if (!id || !userMessage || !Array.isArray(rawTurn.responses)) return null;

  return {
    id,
    userMessage,
    createdAt: timestamp(rawTurn.createdAt, fallbackTime),
    responses: rawTurn.responses
      .map((reply) => sanitizeReply(reply, fallbackTime))
      .filter(Boolean),
  };
}

function sanitizeDecision(rawDecision) {
  if (!isRecord(rawDecision)) return null;
  const id = requiredString(rawDecision.id);
  const title = requiredString(rawDecision.title);
  if (!id || !title || !Array.isArray(rawDecision.turns)) return null;

  const createdAt = timestamp(rawDecision.createdAt, new Date(0).toISOString());
  const updatedAt = timestamp(rawDecision.updatedAt, createdAt);
  const verdict =
    rawDecision.verdict === 'yes' || rawDecision.verdict === 'no'
      ? rawDecision.verdict
      : null;
  const winner =
    verdict === 'yes' ? 'angel' : verdict === 'no' ? 'devil' : null;
  const turns = rawDecision.turns
    .map((turn) => sanitizeTurn(turn, createdAt))
    .filter(Boolean);
  if (turns.length === 0) return null;

  return {
    id,
    title,
    turns,
    status: verdict ? 'decided' : 'active',
    verdict,
    winner,
    createdAt,
    updatedAt,
    decidedAt: verdict ? timestamp(rawDecision.decidedAt, updatedAt) : null,
  };
}

export function emptyDecisionHistory() {
  return { decisions: [], currentDecisionId: null };
}

export function loadDecisionHistory(storage) {
  try {
    const serialized = storage?.getItem?.(HISTORY_STORAGE_KEY);
    if (!serialized) return emptyDecisionHistory();
    const rawSnapshot = JSON.parse(serialized);
    if (
      !isRecord(rawSnapshot) ||
      rawSnapshot.version !== HISTORY_VERSION ||
      !Array.isArray(rawSnapshot.decisions)
    ) {
      return emptyDecisionHistory();
    }

    const decisions = rawSnapshot.decisions
      .map(sanitizeDecision)
      .filter(Boolean)
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );
    const requestedCurrentId = optionalString(rawSnapshot.currentDecisionId);
    const currentDecision = decisions.find(
      (decision) => decision.id === requestedCurrentId && !decision.verdict,
    );

    return {
      decisions,
      currentDecisionId: currentDecision?.id || null,
    };
  } catch {
    return emptyDecisionHistory();
  }
}

export function saveDecisionHistory(storage, snapshot) {
  try {
    storage?.setItem?.(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        version: HISTORY_VERSION,
        currentDecisionId: snapshot.currentDecisionId || null,
        decisions: snapshot.decisions,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function upsertDecisionHistory(decisions, decision) {
  const remaining = decisions.filter(
    (candidate) => candidate.id !== decision.id,
  );
  return [decision, ...remaining].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

export function summarizeDecisionHistory(decisions) {
  const angelWins = decisions.filter(
    (decision) => decision.verdict === 'yes',
  ).length;
  const devilWins = decisions.filter(
    (decision) => decision.verdict === 'no',
  ).length;
  const decided = angelWins + devilWins;

  return {
    total: decisions.length,
    decided,
    active: decisions.length - decided,
    angelWins,
    devilWins,
    angelWinRate: decided ? Math.round((angelWins / decided) * 100) : 0,
    devilWinRate: decided ? Math.round((devilWins / decided) * 100) : 0,
  };
}
