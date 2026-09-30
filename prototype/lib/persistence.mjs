export class PersistenceError extends Error {
  constructor(status, message, retryable = false) {
    super(message);
    this.name = 'PersistenceError';
    this.status = status;
    this.retryable = retryable;
  }
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistenceError(400, '记录格式无效。');
  }
  return value;
}

function text(value, max, allowEmpty = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  ) {
    throw new PersistenceError(400, '记录中的文本为空或过长。');
  }
  return value;
}

export function parseId(value) {
  const id = text(value, 36);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new PersistenceError(400, '记录 ID 无效。');
  }
  return id;
}

function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new PersistenceError(400, '记录时间无效。');
  }
  const time = new Date(value);
  if (time.getUTCFullYear() < 1000 || time.getUTCFullYear() > 9999) {
    throw new PersistenceError(400, '记录时间超出范围。');
  }
  return time.toISOString();
}

export function parseDecision(value) {
  const raw = record(value);
  const seenIds = new Set();
  const uniqueId = (id) => {
    const parsed = parseId(id);
    if (seenIds.has(parsed)) throw new PersistenceError(400, '记录 ID 重复。');
    seenIds.add(parsed);
    return parsed;
  };
  const id = uniqueId(raw.id);
  const title = text(raw.title, 2000);
  if (raw.verdict != null && raw.verdict !== 'yes' && raw.verdict !== 'no') {
    throw new PersistenceError(400, '决策结果无效。');
  }
  const verdict = raw.verdict ?? null;
  if (!Array.isArray(raw.turns) || !raw.turns.length || raw.turns.length > 30) {
    throw new PersistenceError(400, '对话轮次无效。');
  }
  let contextLength = title.length;
  const turns = raw.turns.map((value) => {
    const turn = record(value);
    const userMessage = text(turn.userMessage, 2000);
    contextLength += userMessage.length;
    if (!Array.isArray(turn.responses) || turn.responses.length > 20) {
      throw new PersistenceError(400, '角色回复数量无效。');
    }
    return {
      id: uniqueId(turn.id),
      userMessage,
      createdAt: timestamp(turn.createdAt),
      responses: turn.responses.map((value) => {
        const reply = record(value);
        if (reply.role !== 'angel' && reply.role !== 'devil') {
          throw new PersistenceError(400, '角色无效。');
        }
        if (!['streaming', 'complete', 'error'].includes(reply.status)) {
          throw new PersistenceError(400, '回复状态无效。');
        }
        const content = text(reply.content, 4000, reply.status !== 'complete');
        contextLength += content.length;
        const safetyMode = reply.safetyMode;
        if (
          safetyMode != null &&
          !['standard', 'high_stakes', 'crisis'].includes(safetyMode)
        ) {
          throw new PersistenceError(400, '回复安全模式无效。');
        }
        return {
          id: uniqueId(reply.id),
          role: reply.role,
          content,
          status: reply.status,
          createdAt: timestamp(reply.createdAt),
          ...(safetyMode ? { safetyMode } : {}),
          ...(reply.status === 'error'
            ? {
                error: {
                  message: text(
                    reply.error?.message || '这次回复中断了。',
                    2000,
                  ),
                  retryable: reply.error?.retryable === true,
                },
              }
            : {}),
        };
      }),
    };
  });
  // Persistence also accepts the final output that takes a decision beyond
  // the model's 40k input limit, so it can still be saved and settled.
  if (contextLength > 100000)
    throw new PersistenceError(400, '这局对话记录过长。');
  return {
    id,
    title,
    turns,
    verdict,
    status: verdict ? 'decided' : 'active',
    winner: verdict === 'yes' ? 'angel' : verdict === 'no' ? 'devil' : null,
    createdAt: timestamp(raw.createdAt),
    updatedAt: timestamp(raw.updatedAt),
    decidedAt: verdict ? timestamp(raw.decidedAt) : null,
  };
}

export function parseHistoryUpdate(value) {
  const raw = record(value);
  return {
    decision: raw.decision == null ? null : parseDecision(raw.decision),
    currentDecisionId:
      raw.currentDecisionId == null ? null : parseId(raw.currentDecisionId),
  };
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new PersistenceError(403, '不允许跨站调用。');
  }
}

export async function readJsonBody(request, maxBytes = 500000) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new PersistenceError(415, '请求必须使用 JSON 格式。');
  }
  if (Number(request.headers.get('content-length') || 0) > maxBytes) {
    throw new PersistenceError(413, '请求内容过长。');
  }
  // Read incrementally so a missing Content-Length cannot bypass the limit.
  const reader = request.body?.getReader();
  if (!reader) throw new PersistenceError(400, '请求内容为空。');
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PersistenceError(413, '请求内容过长。');
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body);
  } catch {
    throw new PersistenceError(400, '请求格式无效。');
  }
}

export function persistenceErrorResponse(error) {
  if (error instanceof PersistenceError) {
    return Response.json(
      { error: error.message, retryable: error.retryable },
      { status: error.status },
    );
  }
  // Never log credentials, SQL parameters or provider responses.
  console.error('Database request failed:', error?.code || 'UNKNOWN');
  return Response.json(
    { error: '暂时无法保存或读取对话，请稍后重试。', retryable: true },
    { status: 503 },
  );
}
