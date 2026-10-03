import {
  CRISIS_RESPONSE,
  HIGH_STAKES_NOTE,
  buildFollowupMessages,
  buildReadingMessages,
  detectSafetyMode,
} from '@/lib/agent.mjs';
import { currentUser } from '@/lib/auth.mjs';
import { BaziInputError } from '@/lib/bazi.mjs';
import { buildExtractionMessages, parseExtraction } from '@/lib/extract-llm.mjs';
import {
  FOLLOWUP_FALLBACK,
  advance,
  isBirthComplete,
  sanitizeBirth,
  sanitizeState,
  templateReading,
} from '@/lib/guide.mjs';
import { RequestError, assertSameOrigin, parseGuideRequest, readJsonBody } from '@/lib/request.mjs';

const DEFAULT_API_BASE_URL = 'https://nevatoken.com/v1';
const DEFAULT_MODEL = 'MaaS_GP_6_luna_20260922';
const MAX_OUTPUT_LENGTH = 2_000;
const MAX_ATTEMPTS = 2;
const MAX_GENERATION_MS = 45_000;
const EXTRACTION_MS = 12_000;

type GuideEvent =
  | { type: 'state'; state: unknown }
  | { type: 'profile'; birth: unknown }
  | { type: 'say'; text: string }
  | { type: 'card'; card: unknown }
  | { type: 'start' }
  | { type: 'delta'; content: string }
  | { type: 'end' }
  | { type: 'done' }
  | { type: 'auth' }
  | { type: 'error'; message: string };

type ChatMessage = { role: string; content: string };

class ProviderError extends Error {
  status: number;
  retryable: boolean;

  constructor(status: number, retryable: boolean) {
    super(`Model provider returned ${status}`);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

// 卦象、命盘、解读、追问和吉日都算「结果」，须登录后才给出。
const RESULT_CARDS = new Set(['gua', 'chart', 'days']);
function revealsResult(steps: Array<{ type: string; card?: { kind?: string } }>) {
  return steps.some(
    (step) =>
      step.type === 'reading' ||
      step.type === 'followup' ||
      (step.type === 'card' && RESULT_CARDS.has(step.card?.kind ?? '')),
  );
}

function eventChunk(event: GuideEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function providerSettings() {
  const apiKey = process.env.NEVA_API_KEY?.trim();
  const apiBaseUrl = (process.env.NEVA_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
  const model = (process.env.NEVA_MODEL || DEFAULT_MODEL).trim();
  return { apiKey, apiBaseUrl, model };
}

async function requestModel(messages: ChatMessage[], signal: AbortSignal) {
  const { apiKey, apiBaseUrl, model } = providerSettings();
  if (!apiKey) throw new ProviderError(503, false);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // GPT-6 Luna reasons before it writes; leave room for both.
        body: JSON.stringify({ model, messages, stream: true, max_tokens: 3000 }),
        signal,
      });
      if (response.ok && response.body) return response;
      const retryable = response.status === 429 || response.status >= 500;
      await response.body?.cancel();
      lastError = new ProviderError(response.status, retryable);
      if (!retryable) throw lastError;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ProviderError && !error.retryable) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function deltaContent(chunk: unknown) {
  const choices = (chunk as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.delta?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
    .join('');
}

/** Stream model text through `emit`; returns the number of characters sent. */
async function streamModel(response: Response, emit: (content: string) => void, signal: AbortSignal) {
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.slice(0, MAX_OUTPUT_LENGTH) ?? '';
    if (content) emit(content);
    return content.length;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let length = 0;
  while (!signal.aborted && length < MAX_OUTPUT_LENGTH) {
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
        const content = deltaContent(JSON.parse(data)).slice(0, MAX_OUTPUT_LENGTH - length);
        if (!content) continue;
        length += content.length;
        emit(content);
      } catch {
        // Ignore provider keep-alives and non-content events.
      }
    }
  }
  if (length >= MAX_OUTPUT_LENGTH) await reader.cancel();
  return length;
}

/**
 * Read birth details and the question from the user's message with the model.
 * Returns null on any failure so the guide falls back to its local rules.
 */
async function readFacts(
  message: string,
  phase: string,
  history: Array<{ from: string; text: string }>,
  signal: AbortSignal,
) {
  const { apiKey, apiBaseUrl, model } = providerSettings();
  if (!apiKey) return null;
  const now = new Date();
  const lastGuideLine = [...history].reverse().find((item) => item.from === 'guide')?.text ?? null;
  try {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildExtractionMessages(message, { phase, lastGuideLine, today: now }),
        // Reading, not reasoning: keep it quick.
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
        max_tokens: 600,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(EXTRACTION_MS)]),
    });
    if (!response.ok) throw new ProviderError(response.status, false);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseExtraction(payload.choices?.[0]?.message?.content ?? '', message, now);
  } catch (error) {
    if (!signal.aborted) console.error('Fact extraction failed:', (error as Error).message);
    return null;
  }
}

/**
 * Speak a model-written message, falling back to local text when the model
 * is unavailable or fails before saying anything.
 */
async function speak(
  messages: ChatMessage[],
  fallback: string,
  send: (event: GuideEvent) => void,
  signal: AbortSignal,
) {
  send({ type: 'start' });
  let sent = 0;
  // The model gets its own deadline, so a slow or failed reply still ends in words.
  const modelSignal = AbortSignal.any([signal, AbortSignal.timeout(MAX_GENERATION_MS)]);
  try {
    const response = await requestModel(messages, modelSignal);
    sent = await streamModel(response, (content) => send({ type: 'delta', content }), modelSignal);
    if (!sent) throw new Error('Empty model response.');
  } catch (error) {
    if (signal.aborted) throw error;
    if (!(error instanceof ProviderError && error.status === 503)) {
      console.error('Guide generation failed:', (error as Error).message);
    }
    send({ type: 'delta', content: sent ? '\n\n言未尽而灯摇 请再问之' : fallback });
  }
  send({ type: 'end' });
}

export async function POST(request: Request) {
  let parsed;
  try {
    assertSameOrigin(request);
    parsed = parseGuideRequest(await readJsonBody(request));
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 400;
    return Response.json({ error: (error as Error).message }, { status });
  }

  const state = sanitizeState(parsed.state);
  const profileBirth = sanitizeBirth(parsed.profile);
  const profile = isBirthComplete(profileBirth) ? profileBirth : null;
  const signedIn = currentUser(request) !== null;
  const safetyMode = detectSafetyMode([state.question ?? '', parsed.message ?? ''].join('\n'));

  const abortController = new AbortController();
  const signal = AbortSignal.any([request.signal, abortController.signal]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GuideEvent) => {
        if (!signal.aborted) controller.enqueue(eventChunk(event));
      };
      try {
        if (safetyMode === 'crisis') {
          send({ type: 'say', text: CRISIS_RESPONSE });
          send({ type: 'done' });
          return;
        }

        const facts = parsed.message ? await readFacts(parsed.message, state.phase, parsed.history, signal) : null;
        const result = advance({
          state,
          profile,
          message: parsed.message,
          action: parsed.action,
          facts,
          now: new Date(),
        });
        if (!signedIn && revealsResult(result.steps)) {
          // 不推进状态：登录后客户端原样重发这次请求。
          send({ type: 'auth' });
          send({ type: 'done' });
          return;
        }
        send({ type: 'state', state: result.state });

        for (const step of result.steps) {
          if (step.type === 'profile') send({ type: 'profile', birth: step.birth });
          else if (step.type === 'say') send({ type: 'say', text: step.text });
          else if (step.type === 'card') send({ type: 'card', card: step.card });
          else if (step.type === 'reading') {
            const fallback =
              templateReading(step.payload) + (safetyMode === 'high_stakes' ? `\n${HIGH_STAKES_NOTE}` : '');
            await speak(buildReadingMessages(step.payload, safetyMode), fallback, send, signal);
          } else if (step.type === 'followup') {
            await speak(
              buildFollowupMessages(step.payload, parsed.history, safetyMode),
              FOLLOWUP_FALLBACK,
              send,
              signal,
            );
          }
        }
        send({ type: 'done' });
      } catch (error) {
        if (error instanceof BaziInputError) {
          send({ type: 'error', message: `生辰有点问题：${error.message}` });
        } else if (!signal.aborted) {
          console.error('Guide request failed:', (error as Error).message);
          send({ type: 'error', message: '灯灭了一瞬，请再说一次。' });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled client.
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}
