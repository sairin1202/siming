import {
  AgentRequestError,
  CRISIS_RESPONSE,
  buildAgentMessages,
  getRequestSafetyMode,
  parseAgentRequest,
} from '@/lib/agent.mjs';
import { beginGeneration, finishGeneration, MAX_GENERATION_MS, withDatabaseSession } from '@/lib/database.mjs';
import { assertSameOrigin, parseDecision, parseId, PersistenceError, persistenceErrorResponse, readJsonBody } from '@/lib/persistence.mjs';

const DEFAULT_API_BASE_URL = 'https://nevatoken.com/v1';
const DEFAULT_MODEL = 'MaaS_GP_5.6_luna_20260709';
const MAX_OUTPUT_LENGTH = 4_000;
const MAX_ATTEMPTS = 3;

type StreamEvent =
  | { type: 'meta'; safetyMode: 'standard' | 'high_stakes' | 'crisis' }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string; retryable: boolean };

class ProviderError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, retryable: boolean) {
    super(`Luna provider returned ${status}`);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

function eventChunk(event: StreamEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function providerSettings() {
  const apiKey = process.env.NEVA_API_KEY?.trim();
  const apiBaseUrl = (process.env.NEVA_API_BASE_URL || DEFAULT_API_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const model = (process.env.NEVA_MODEL || DEFAULT_MODEL).trim();

  return { apiKey, apiBaseUrl, model };
}

async function requestLuna(
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
) {
  const { apiKey, apiBaseUrl, model } = providerSettings();
  if (!apiKey) throw new ProviderError(503, false);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: 600,
        }),
        signal,
      });

      if (response.ok && response.body) return response;

      const retryable = response.status === 429 || response.status >= 500;
      await response.body?.cancel();
      lastError = new ProviderError(response.status, retryable);
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw lastError;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ProviderError && !error.retryable) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) throw error;
    }

    await sleep(350 * 2 ** attempt, signal);
  }

  throw lastError;
}

function deltaContent(chunk: unknown) {
  if (!chunk || typeof chunk !== 'object') return '';
  const choices = (chunk as { choices?: unknown }).choices;
  if (
    !Array.isArray(choices) ||
    !choices[0] ||
    typeof choices[0] !== 'object'
  ) {
    return '';
  }
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return '';
  const content = (delta as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      part &&
      typeof part === 'object' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('');
}

async function pipeLunaStream(
  response: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
  onContent: (content: string) => void,
) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('Luna returned an empty response.');
    onContent(content.slice(0, MAX_OUTPUT_LENGTH));
    controller.enqueue(
      eventChunk({
        type: 'delta',
        content: content.slice(0, MAX_OUTPUT_LENGTH),
      }),
    );
    return;
  }

  if (!response.body) throw new Error('Luna returned no response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outputLength = 0;

  while (!signal.aborted && outputLength < MAX_OUTPUT_LENGTH) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const content = deltaContent(JSON.parse(data));
        if (!content) continue;
        const remaining = MAX_OUTPUT_LENGTH - outputLength;
        const safeContent = content.slice(0, remaining);
        outputLength += safeContent.length;
        onContent(safeContent);
        controller.enqueue(eventChunk({ type: 'delta', content: safeContent }));
      } catch {
        // Ignore provider keep-alives and non-content events.
      }
    }
  }

  if (!outputLength) throw new Error('Luna returned an empty response.');
  if (outputLength >= MAX_OUTPUT_LENGTH) await reader.cancel();
}

function publicError(error: unknown): Extract<StreamEvent, { type: 'error' }> {
  if (error instanceof ProviderError) {
    if (error.status === 503 && !process.env.NEVA_API_KEY) {
      return {
        type: 'error',
        code: 'NOT_CONFIGURED',
        message: 'Luna 还没有配置好，请稍后再试。',
        retryable: false,
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        type: 'error',
        code: 'UPSTREAM_AUTH',
        message: 'Luna 的访问凭证已失效，请联系管理员。',
        retryable: false,
      };
    }
    if (error.status === 429) {
      return {
        type: 'error',
        code: 'RATE_LIMIT',
        message: 'Luna 此刻有点忙，可以稍后重试。',
        retryable: true,
      };
    }
    if (error.status === 400 || error.status === 404) {
      return {
        type: 'error',
        code: 'MODEL_CONFIGURATION',
        message: 'Luna 模型配置需要更新，请联系管理员。',
        retryable: false,
      };
    }
  }
  return {
    type: 'error',
    code: 'GENERATION_FAILED',
    message: '这次回复中断了，可以保留当前对话后重试。',
    retryable: true,
  };
}

export async function POST(request: Request) {
  let agentRequest;
  let generation;
  let cookie: string | null;
  try {
    assertSameOrigin(request);
    const payload = await readJsonBody(request);
    const decision = parseDecision(payload.decision);
    const replyId = parseId(payload.replyId);
    const role = payload.role;
    const latestTurn = decision.turns[decision.turns.length - 1];
    const target = latestTurn.responses[latestTurn.responses.length - 1];
    if (!target || target.id !== replyId || target.role !== role || target.status !== 'streaming') {
      throw new PersistenceError(400, '只能生成当前轮最后一条待回复消息。');
    }
    // Validate model context before starting a database generation.
    parseAgentRequest({ role, decisionTitle: decision.title, turns: decision.turns });
    const result = await withDatabaseSession(request, (connection, ownerId) => beginGeneration(connection, ownerId, decision, replyId, role));
    generation = result.value;
    cookie = result.cookie;
    agentRequest = parseAgentRequest({ role, decisionTitle: generation.decision.title, turns: generation.decision.turns });
  } catch (error) {
    if (error instanceof AgentRequestError) return Response.json({ error: error.message }, { status: 400 });
    return persistenceErrorResponse(error);
  }

  const safetyMode = getRequestSafetyMode(agentRequest);
  const abortController = new AbortController();
  const signal = AbortSignal.any([request.signal, abortController.signal, AbortSignal.timeout(MAX_GENERATION_MS)]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let content = '';
      let persisted = false;
      try {
        controller.enqueue(eventChunk({ type: 'meta', safetyMode }));
        if (safetyMode === 'crisis') {
          content = CRISIS_RESPONSE;
          controller.enqueue(
            eventChunk({ type: 'delta', content: CRISIS_RESPONSE }),
          );
        } else {
          const messages = buildAgentMessages(agentRequest, safetyMode);
          const response = await requestLuna(messages, signal);
          await pipeLunaStream(response, controller, signal, (delta) => { content += delta; });
        }
        if (signal.aborted) throw new Error('Generation interrupted.');
        // Only report completion after the full reply has reached MySQL.
        const saved = await finishGeneration(generation, { content, status: 'complete', safetyMode });
        if (!saved) throw new Error('Generation superseded.');
        persisted = true;
        if (!signal.aborted)
          controller.enqueue(eventChunk({ type: 'done' }));
      } catch (error) {
        const publicFailure = publicError(error);
        if (!persisted) {
          try {
            await finishGeneration(generation, { content, status: 'error', safetyMode, error: publicFailure });
          } catch (databaseError) {
            console.error('Reply persistence failed:', (databaseError as { code?: string }).code || 'UNKNOWN');
          }
        }
        if (!request.signal.aborted && !abortController.signal.aborted) {
          controller.enqueue(eventChunk(publicFailure));
        }
      } finally {
        if (!abortController.signal.aborted) controller.close();
      }
    },
    cancel() { abortController.abort(); },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
}
