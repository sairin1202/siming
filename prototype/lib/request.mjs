export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

/** The page's own origin; behind a trusted proxy (VINEXT_TRUST_PROXY=1) the scheme comes from it. */
function ownOrigin(request) {
  const url = new URL(request.url);
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  if (process.env.VINEXT_TRUST_PROXY === '1' && (forwarded === 'https' || forwarded === 'http')) {
    return `${forwarded}://${url.host}`;
  }
  return url.origin;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== ownOrigin(request)) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new RequestError(403, '不允许跨站调用。');
  }
}

export async function readJsonBody(request, maxBytes = 64_000) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new RequestError(415, '请求必须使用 JSON 格式。');
  }
  if (Number(request.headers.get('content-length') || 0) > maxBytes) {
    throw new RequestError(413, '请求内容过长。');
  }
  // Read incrementally so a missing Content-Length cannot bypass the limit.
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, '请求内容为空。');
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestError(413, '请求内容过长。');
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body);
  } catch {
    throw new RequestError(400, '请求格式无效。');
  }
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY = 12;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the untrusted guide request body. */
export function parseGuideRequest(payload) {
  if (!isRecord(payload)) throw new RequestError(400, '请求格式无效。');
  const { message, action, history } = payload;

  if (message != null) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new RequestError(400, '消息不能为空。');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new RequestError(400, '这段话太长了，挑重点说给我听。');
    }
  }

  let parsedAction = null;
  if (action != null) {
    if (!isRecord(action) || !['mode', 'confirm_birth', 'edit_birth', 'submit_birth', 'cast', 'decide'].includes(action.type)) {
      throw new RequestError(400, '未知的操作。');
    }
    parsedAction = {
      type: action.type,
      choice: action.choice === 'go' ? 'go' : 'stop',
      // The birth form's fields; validated field by field in guide.mjs.
      birth: isRecord(action.birth) ? action.birth : null,
      // Six coin-throw values; validated in gua.mjs.
      tosses: Array.isArray(action.tosses) ? action.tosses.slice(0, 6) : null,
      mode: action.mode === 'gua' || action.mode === 'ming' ? action.mode : null,
    };
  }
  if (message == null && !parsedAction) throw new RequestError(400, '请求格式无效。');

  const parsedHistory = Array.isArray(history)
    ? history
        .slice(-MAX_HISTORY)
        .filter(
          (item) =>
            isRecord(item) &&
            (item.from === 'guide' || item.from === 'user') &&
            typeof item.text === 'string',
        )
        .map((item) => ({ from: item.from, text: item.text.slice(0, 1_000) }))
    : [];

  return {
    message: message == null ? undefined : message.trim(),
    action: parsedAction ?? undefined,
    state: payload.state,
    profile: payload.profile,
    history: parsedHistory,
  };
}

/** 把 RequestError、SmsError 转成 JSON 响应；其他错误记日志并返回 500。 */
export function errorResponse(error) {
  if (error instanceof RequestError || error?.name === 'SmsError') {
    return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  console.error('Request failed:', error?.message);
  return Response.json({ error: '出了点问题，请稍后再试。' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}
