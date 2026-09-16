'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Feather,
  Flame,
  Gavel,
  History as HistoryIcon,
  MessageCircleMore,
  RotateCcw,
  Sparkles,
  Swords,
  Trophy,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  loadDecisionHistory,
  saveDecisionHistory,
  summarizeDecisionHistory,
  upsertDecisionHistory,
} from '@/lib/history.mjs';
import { resolveCharacterState } from '@/lib/character-state.mjs';

type Role = 'angel' | 'devil';
type CharacterState = 'idle' | 'thinking' | 'speaking' | 'listening' | 'victory' | 'defeat';
type Verdict = 'yes' | 'no';
type ReplyStatus = 'streaming' | 'complete' | 'error';

type Reply = {
  id: string;
  role: Role;
  content: string;
  status: ReplyStatus;
  createdAt: string;
  error?: {
    message: string;
    retryable: boolean;
  };
  safetyMode?: 'standard' | 'high_stakes' | 'crisis';
};

type Turn = {
  id: string;
  userMessage: string;
  createdAt: string;
  responses: Reply[];
};

type Decision = {
  id: string;
  title: string;
  turns: Turn[];
  status: 'active' | 'decided';
  verdict: Verdict | null;
  winner: Role | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};

type AgentStreamEvent =
  | { type: 'meta'; safetyMode: 'standard' | 'high_stakes' | 'crisis' }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string; retryable: boolean };

class AgentClientError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'AgentClientError';
    this.retryable = retryable;
  }
}

const poseIndex: Record<CharacterState, number> = {
  idle: 0,
  thinking: 2,
  speaking: 1,
  listening: 2,
  victory: 3,
  defeat: 4,
};

const stateLabel: Record<CharacterState, string> = {
  idle: '漂浮待命',
  thinking: '正在思考',
  speaking: '正在发言',
  listening: '正在倾听',
  victory: '赢得本局',
  defeat: '接受结果',
};

const roleCopy = {
  angel: {
    camp: 'YES',
    name: '天使',
    short: '看见值得迈出的一步',
    summon: '召唤天使',
  },
  devil: {
    camp: 'NO',
    name: '恶魔',
    short: '看清不该付出的代价',
    summon: '召唤恶魔',
  },
} as const;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  return new Date().toISOString();
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function CharacterFigure({ side, state, compact = false }: { side: Role; state: CharacterState; compact?: boolean }) {
  const copy = roleCopy[side];

  return (
    <div
      className={`character-figure character-figure--${side} character-figure--${state}${compact ? ' character-figure--compact' : ''}`}
      style={{ '--pose': poseIndex[state] } as React.CSSProperties}
    >
      <div className="character-aura" aria-hidden="true" />
      <div className="character-rings" aria-hidden="true"><i /><i /><i /></div>
      <div className="character-sprite">
        {/* oxlint-disable-next-line next/no-img-element -- sprite sheets rely on exact CSS cropping. */}
        <img src={`/characters/${side}-states-flying.png`} alt={`${copy.name} · ${stateLabel[state]}`} />
      </div>
    </div>
  );
}

function StartScreen({
  historyCount,
  onHistory,
  onStart,
}: {
  historyCount: number;
  onHistory: () => void;
  onStart: (question: string, role: Role) => void;
}) {
  const [question, setQuestion] = useState('');
  const [showError, setShowError] = useState(false);

  function submitTo(role: Role) {
    if (!question.trim()) {
      setShowError(true);
      return;
    }
    onStart(question.trim(), role);
  }

  return (
    <main className="start-shell">
      <AppHeader room="01" historyCount={historyCount} onHistory={onHistory} />

      <section className="opening-stage" aria-label="决策舞台">
        <h1 className="sr-only">Angel & Devil 决策舞台</h1>
        <div className="intro-character intro-character--angel">
          <CharacterFigure side="angel" state="idle" />
          <CharacterCaption side="angel" />
        </div>

        <div className="intro-character intro-character--devil">
          <CharacterFigure side="devil" state="idle" />
          <CharacterCaption side="devil" />
        </div>

        <div className="opening-dock" id="decision">
          <div className="opening-dock__meta">
            <label htmlFor="decision-question"><Sparkles /> 写下你正在犹豫的事</label>
            <span>选一个角色，先听他的看法</span>
          </div>
          <div className="opening-dock__controls">
            <Textarea
              id="decision-question"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                if (showError) setShowError(false);
              }}
              placeholder="例如：要不要接受一个很有挑战的新项目？"
              rows={1}
              aria-invalid={showError}
              aria-describedby={showError ? 'decision-question-error' : undefined}
            />
            <Button type="button" className="dock-role dock-role--angel" onClick={() => submitTo('angel')}><Feather /> 对话天使</Button>
            <Button type="button" className="dock-role dock-role--devil" onClick={() => submitTo('devil')}><Flame /> 对话恶魔</Button>
          </div>
          {showError ? <p className="opening-dock__error" id="decision-question-error" role="alert">先写下你要决定的事。</p> : null}
        </div>
      </section>
    </main>
  );
}

function AppHeader({
  room = '01',
  title,
  turnCount,
  historyCount = 0,
  onDecide,
  onHistory,
}: {
  room?: string;
  title?: string;
  turnCount?: number;
  historyCount?: number;
  onDecide?: () => void;
  onHistory?: () => void;
}) {
  return (
    <header className="site-header">
      <a href="#main" className="brand" aria-label="Angel & Devil">
        <span className="brand-mark"><Feather /></span>
        <span>ANGEL <i>&</i> DEVIL</span>
      </a>
      {title ? (
        <div className="decision-heading">
          <small>当前决策</small>
          <strong>{title}</strong>
        </div>
      ) : null}
      <div className="header-actions">
        {turnCount ? <span className="turn-count">TURN {String(turnCount).padStart(2, '0')}</span> : null}
        {onHistory ? (
          <Button onClick={onHistory} className="history-button" variant="ghost">
            <HistoryIcon /> 历史{historyCount ? <span>{historyCount}</span> : null}
          </Button>
        ) : null}
        {onDecide ? <Button onClick={onDecide} className="decide-button"><Gavel /> 作出决定</Button> : null}
        {!title ? <div className="round-badge"><span>DECISION ROOM</span><strong>{room}</strong></div> : null}
      </div>
    </header>
  );
}

function CharacterCaption({ side }: { side: Role }) {
  const copy = roleCopy[side];
  return (
    <div className={`character-caption character-caption--${side}`}>
      <span>{copy.camp}</span>
      <strong>{copy.name}</strong>
      <small>{copy.short}</small>
    </div>
  );
}

function CharacterPanel({
  side,
  state,
  reply,
  turnId,
  isThinking,
  onRetry,
}: {
  side: Role;
  state: CharacterState;
  reply: Reply | null;
  turnId: string | null;
  isThinking: boolean;
  onRetry: (turnId: string, replyId: string) => void;
}) {
  const copy = roleCopy[side];
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reply?.status === 'streaming') bubbleRef.current?.scrollTo({ top: bubbleRef.current.scrollHeight });
  }, [reply?.content, reply?.status]);

  return (
    <section className={`character-panel character-panel--${side} is-${state}`} aria-label={`${copy.name}，当前${stateLabel[state]}`}>
      <span className="panel-state"><i /> {stateLabel[state]}</span>
      <CharacterFigure side={side} state={state} />
      <CharacterCaption side={side} />
      <div className={`speech-bubble speech-bubble--${side}${reply?.status === 'streaming' ? ' is-streaming' : ''}`} aria-live="polite">
        <div className="speech-bubble__content" ref={bubbleRef}>
          <div className="speech-bubble__head">
            <span>{side === 'angel' ? <Feather /> : <Flame />}{reply?.safetyMode === 'crisis' ? '安全支持' : copy.name}</span>
            <small>{copy.camp}</small>
          </div>
          {reply?.content ? <p>{reply.content}</p> : isThinking ? (
            <div className="speech-bubble__thinking"><i /><i /><i /> 正在整理想法…</div>
          ) : <p className="speech-bubble__placeholder">还没轮到我发言。想听我的看法，就点下方按钮。</p>}
          {reply?.status === 'error' ? (
            <div className="speech-bubble__error" role="alert">
              <span>{reply.error?.message || '这次回复中断了。'}</span>
              {reply.error?.retryable && turnId ? <button type="button" onClick={() => onRetry(turnId, reply.id)}><RotateCcw /> 重试</button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Conversation({
  turns,
  activeReplyId,
  onRetry,
}: {
  turns: Turn[];
  activeReplyId: string | null;
  onRetry: (turnId: string, replyId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeReply = turns
    .flatMap((turn) => turn.responses)
    .find((reply) => reply.id === activeReplyId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, activeReplyId]);

  return (
    <div className="conversation-scroll" ref={scrollRef} aria-live="polite">
      <div className="conversation-intro">
        <Swords />
        <span>双方共享完整对话，但立场始终相反</span>
      </div>
      {turns.map((turn, turnIndex) => (
        <section className="turn-group" key={turn.id} aria-labelledby={`${turn.id}-title`}>
          <div className="turn-divider"><span id={`${turn.id}-title`}>TURN {String(turnIndex + 1).padStart(2, '0')}</span><i /></div>
          <div className="user-message">
            <small>你的补充</small>
            <p>{turn.userMessage}</p>
          </div>
          <div className="responses">
            {turn.responses.map((reply) =>
              reply.content || reply.status === 'error' ? (
                <article
                  className={`agent-message agent-message--${reply.role}${reply.status === 'streaming' ? ' is-streaming' : ''}${reply.safetyMode === 'crisis' ? ' is-safety' : ''}`}
                  key={reply.id}
                >
                  <div className="message-role">
                    <span>{reply.role === 'angel' ? <Feather /> : <Flame />}</span>
                    <strong>{reply.safetyMode === 'crisis' ? '安全支持' : roleCopy[reply.role].name}</strong>
                    <small>{reply.safetyMode === 'crisis' ? 'SAFETY FIRST' : roleCopy[reply.role].camp}</small>
                  </div>
                  {reply.content ? <p>{reply.content}</p> : null}
                  {reply.status === 'error' ? (
                    <div className="reply-error" role="alert">
                      <span>{reply.error?.message || '这次回复中断了。'}</span>
                      {reply.error?.retryable ? (
                        <button type="button" onClick={() => onRetry(turn.id, reply.id)}>
                          <RotateCcw /> 重试
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ) : null,
            )}
            {activeReply && !activeReply.content && turn.responses.some((reply) => reply.id === activeReply.id) ? (
              <div className={`thinking-message thinking-message--${activeReply.role}`}>
                <span /><span /><span /> {roleCopy[activeReply.role].name}正在整理观点
              </div>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function Composer({ disabled, onSummon, onNewTurn, onHistory, onDecide }: { disabled: boolean; onSummon: (role: Role) => void; onNewTurn: (message: string, role: Role) => void; onHistory: () => void; onDecide: () => void }) {
  const [draft, setDraft] = useState('');

  function submitTo(role: Role) {
    if (draft.trim()) {
      onNewTurn(draft.trim(), role);
      setDraft('');
    } else {
      onSummon(role);
    }
  }

  return (
    <div className="dialogue-dock">
      <div className="dialogue-dock__meta">
        <span><Sparkles /> 你想听谁说？<small>{draft.trim() ? '这句补充会开启新的一轮' : '不输入也可以直接继续对话'}</small></span>
        <div>
          <button type="button" onClick={onHistory}><MessageCircleMore /> 对话记录</button>
          <button type="button" onClick={onDecide} className="dock-decide"><Gavel /> 作出决定</button>
        </div>
      </div>
      <div className="dialogue-dock__controls">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="补充一句（可选）…"
          aria-label="补充信息，可选"
          disabled={disabled}
          rows={1}
        />
        <Button onClick={() => submitTo('angel')} disabled={disabled} className="dock-role dock-role--angel"><Feather /> 对话天使</Button>
        <Button onClick={() => submitTo('devil')} disabled={disabled} className="dock-role dock-role--devil"><Flame /> 对话恶魔</Button>
      </div>
    </div>
  );
}

function ResultOverlay({ decision, onRestart }: { decision: Decision; onRestart: () => void }) {
  const winner: Role = decision.verdict === 'yes' ? 'angel' : 'devil';
  const loser: Role = winner === 'angel' ? 'devil' : 'angel';
  const allReplies = decision.turns
    .flatMap((turn) => turn.responses)
    .filter((reply) => reply.status === 'complete');
  const angelCount = allReplies.filter((reply) => reply.role === 'angel').length;
  const devilCount = allReplies.filter((reply) => reply.role === 'devil').length;

  return (
    <dialog open className={`result-overlay result-overlay--${winner}`} aria-labelledby="result-title">
      <div className="result-rays" aria-hidden="true" />
      <div className="result-particles" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div>
      <div className="result-loser"><CharacterFigure side={loser} state="defeat" compact /></div>
      <div className="result-winner"><CharacterFigure side={winner} state="victory" /></div>
      <section className="result-card">
        <span className="result-kicker">FINAL VERDICT · {decision.verdict?.toUpperCase()}</span>
        <h2 id="result-title">{roleCopy[winner].name}<em>赢得了这一局</em></h2>
        <p>{decision.verdict === 'yes' ? '你选择了向前一步。带上边界，也带上勇气。' : '你选择了暂不行动。保护精力，也是清醒的决定。'}</p>
        <div className="result-stats">
          <div><Feather /><span>天使发言</span><strong>{angelCount}</strong></div>
          <i />
          <div><Flame /><span>恶魔发言</span><strong>{devilCount}</strong></div>
        </div>
        <Button onClick={onRestart} className="restart-button"><RotateCcw /> 开始新的决策</Button>
      </section>
    </dialog>
  );
}

function HistoryDialog({
  decisions,
  open,
  onOpenChange,
  onOpenDecision,
}: {
  decisions: Decision[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDecision: (decision: Decision) => void;
}) {
  const stats = summarizeDecisionHistory(decisions);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="history-dialog">
        <DialogHeader>
          <span className="dialog-kicker"><HistoryIcon /> DECISION ARCHIVE</span>
          <DialogTitle>你的决策记录</DialogTitle>
          <DialogDescription>每次对话和最终选择都保存在这台设备上。</DialogDescription>
        </DialogHeader>

        <section className="career-stats" aria-label="胜负统计">
          <div className="career-stat career-stat--total">
            <HistoryIcon />
            <span>总决策<small>{stats.active ? `${stats.active} 局进行中` : '全部已结算'}</small></span>
            <strong>{stats.total}</strong>
          </div>
          <div className="career-stat career-stat--angel">
            <Feather />
            <span>天使胜场<small>{stats.decided ? `胜率 ${stats.angelWinRate}%` : '尚无战绩'}</small></span>
            <strong>{stats.angelWins}</strong>
          </div>
          <div className="career-stat career-stat--devil">
            <Flame />
            <span>恶魔胜场<small>{stats.decided ? `胜率 ${stats.devilWinRate}%` : '尚无战绩'}</small></span>
            <strong>{stats.devilWins}</strong>
          </div>
        </section>

        <div className="history-section-heading">
          <span><Clock3 /> 历史会话</span>
          <small>{stats.decided} 局已结算</small>
        </div>

        <div className="history-list">
          {decisions.length ? (
            decisions.map((item) => {
              const replyCount = item.turns
                .flatMap((turn) => turn.responses)
                .filter((reply) => reply.status === 'complete').length;
              const winner = item.verdict === 'yes' ? 'angel' : item.verdict === 'no' ? 'devil' : null;

              return (
                <button
                  type="button"
                  className={`history-item${winner ? ` history-item--${winner}` : ''}`}
                  key={item.id}
                  onClick={() => onOpenDecision(item)}
                >
                  <span className="history-item-icon">
                    {winner === 'angel' ? <Feather /> : winner === 'devil' ? <Flame /> : <Clock3 />}
                  </span>
                  <span className="history-item-copy">
                    <strong>{item.title}</strong>
                    <small>{formatHistoryDate(item.updatedAt)} · {item.turns.length} Turns · {replyCount} 条回复</small>
                  </span>
                  <span className={`history-status${winner ? ` history-status--${winner}` : ''}`}>
                    {winner ? <Trophy /> : null}
                    {winner === 'angel' ? 'YES' : winner === 'devil' ? 'NO' : '进行中'}
                  </span>
                  <ChevronRight />
                </button>
              );
            })
          ) : (
            <div className="history-empty">
              <HistoryIcon />
              <strong>还没有决策记录</strong>
              <span>开启第一局后，对话会自动出现在这里。</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [history, setHistory] = useState<Decision[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [thinkingRole, setThinkingRole] = useState<Role | null>(null);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const [lastSpeaker, setLastSpeaker] = useState<Role | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const activeRequestRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const speakerHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const snapshot = loadDecisionHistory(window.localStorage);
    const restoredDecision = snapshot.decisions.find(
      (item: Decision) => item.id === snapshot.currentDecisionId,
    ) as Decision | undefined;
    queueMicrotask(() => {
      setHistory(snapshot.decisions as Decision[]);
      setDecision(restoredDecision || null);
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (decision && history.find((item) => item.id === decision.id) !== decision) {
      queueMicrotask(() => {
        setHistory((current) => upsertDecisionHistory(current, decision) as Decision[]);
      });
      return;
    }

    const saved = saveDecisionHistory(window.localStorage, {
      decisions: history,
      currentDecisionId: decision && !decision.verdict ? decision.id : null,
    });
    queueMicrotask(() => setStorageError(!saved));
  }, [decision, history, isHydrated]);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    if (speakerHoldTimerRef.current) clearTimeout(speakerHoldTimerRef.current);
  }, []);

  function clearSpeakerHold() {
    if (speakerHoldTimerRef.current) clearTimeout(speakerHoldTimerRef.current);
    speakerHoldTimerRef.current = null;
    setLastSpeaker(null);
  }

  function holdLastSpeaker(role: Role) {
    if (speakerHoldTimerRef.current) clearTimeout(speakerHoldTimerRef.current);
    setLastSpeaker(role);
    speakerHoldTimerRef.current = setTimeout(() => {
      setLastSpeaker((current) => (current === role ? null : current));
      speakerHoldTimerRef.current = null;
    }, 1400);
  }

  function abortActiveRequest() {
    const activeRequest = activeRequestRef.current;
    activeRequestRef.current = null;
    activeRequest?.controller.abort();
  }

  function updateReply(replyId: string, updater: (reply: Reply) => Reply) {
    setDecision((current) => {
      if (!current || current.verdict) return current;
      return {
        ...current,
        updatedAt: now(),
        turns: current.turns.map((turn) => ({
          ...turn,
          responses: turn.responses.map((reply) =>
            reply.id === replyId ? updater(reply) : reply,
          ),
        })),
      };
    });
  }

  function markReplyFailed(replyId: string, message: string, retryable: boolean) {
    updateReply(replyId, (reply) => ({
      ...reply,
      status: 'error',
      error: { message, retryable },
    }));
  }

  async function requestReply(
    role: Role,
    sourceDecision: Decision,
    replyId: string,
  ) {
    abortActiveRequest();
    const requestId = makeId('request');
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };
    clearSpeakerHold();
    setThinkingRole(role);
    setActiveReplyId(replyId);
    setIsReceiving(false);

    const isCurrentRequest = () => activeRequestRef.current?.id === requestId;

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role,
          decisionTitle: sourceDecision.title,
          turns: sourceDecision.turns,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new AgentClientError(
          payload?.error || '无法开始这次回复。',
          response.status >= 500,
        );
      }
      if (!response.body) throw new AgentClientError('服务器没有返回可读的内容。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      const handleEvent = (event: AgentStreamEvent) => {
        if (!isCurrentRequest()) return;
        if (event.type === 'meta') {
          updateReply(replyId, (reply) => ({ ...reply, safetyMode: event.safetyMode }));
        } else if (event.type === 'delta' && event.content) {
          setIsReceiving(true);
          updateReply(replyId, (reply) => ({
            ...reply,
            content: `${reply.content}${event.content}`,
          }));
        } else if (event.type === 'error') {
          throw new AgentClientError(event.message, event.retryable);
        } else if (event.type === 'done') {
          finished = true;
        }
      };

      while (isCurrentRequest()) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          handleEvent(JSON.parse(data) as AgentStreamEvent);
        }
      }

      if (!isCurrentRequest()) return;
      if (!finished) throw new AgentClientError('连接在回复完成前中断了。');
      updateReply(replyId, (reply) => ({ ...reply, status: 'complete', error: undefined }));
      holdLastSpeaker(role);
    } catch (error) {
      if (!isCurrentRequest() || controller.signal.aborted) return;
      const clientError =
        error instanceof AgentClientError
          ? error
          : new AgentClientError('这次回复中断了，可以保留当前对话后重试。');
      markReplyFailed(replyId, clientError.message, clientError.retryable);
    } finally {
      if (isCurrentRequest()) {
        activeRequestRef.current = null;
        setThinkingRole(null);
        setActiveReplyId(null);
        setIsReceiving(false);
      }
    }
  }

  function appendReply(sourceDecision: Decision, turnId: string, role: Role) {
    const replyId = makeId('reply');
    const createdAt = now();
    const nextDecision: Decision = {
      ...sourceDecision,
      updatedAt: createdAt,
      turns: sourceDecision.turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              responses: [
                ...turn.responses,
                { id: replyId, role, content: '', status: 'streaming', createdAt },
              ],
            }
          : turn,
      ),
    };
    setDecision(nextDecision);
    void requestReply(role, nextDecision, replyId);
  }

  function startDecision(question: string, role: Role) {
    const turnId = makeId('turn');
    const createdAt = now();
    const nextDecision: Decision = {
      id: makeId('decision'),
      title: question,
      status: 'active',
      verdict: null,
      winner: null,
      createdAt,
      updatedAt: createdAt,
      decidedAt: null,
      turns: [{ id: turnId, userMessage: question, responses: [], createdAt }],
    };
    appendReply(nextDecision, turnId, role);
  }

  function summon(role: Role) {
    if (!decision || thinkingRole || decision.verdict) return;
    const turn = decision.turns[decision.turns.length - 1];
    appendReply(decision, turn.id, role);
  }

  function addTurn(message: string, role: Role) {
    if (!decision || thinkingRole || decision.verdict) return;
    const turnId = makeId('turn');
    const createdAt = now();
    const nextDecision: Decision = {
      ...decision,
      updatedAt: createdAt,
      turns: [...decision.turns, { id: turnId, userMessage: message, responses: [], createdAt }],
    };
    appendReply(nextDecision, turnId, role);
  }

  function retryReply(turnId: string, replyId: string) {
    if (!decision || thinkingRole || decision.verdict) return;
    const turn = decision.turns.find((candidate) => candidate.id === turnId);
    const reply = turn?.responses.find((candidate) => candidate.id === replyId);
    if (!reply || reply.status !== 'error' || !reply.error?.retryable) return;

    const nextDecision: Decision = {
      ...decision,
      updatedAt: now(),
      turns: decision.turns.map((candidate) =>
        candidate.id === turnId
          ? {
              ...candidate,
              responses: candidate.responses.map((candidateReply) =>
                candidateReply.id === replyId
                  ? {
                      ...candidateReply,
                      content: '',
                      status: 'streaming',
                      error: undefined,
                      safetyMode: undefined,
                    }
                  : candidateReply,
              ),
            }
          : candidate,
      ),
    };
    setDecision(nextDecision);
    void requestReply(reply.role, nextDecision, replyId);
  }

  function settle(verdict: Verdict) {
    if (!decision) return;
    abortActiveRequest();
    clearSpeakerHold();
    setThinkingRole(null);
    setActiveReplyId(null);
    setIsReceiving(false);
    const decidedAt = now();
    setDecision((current) => (current ? {
      ...current,
      status: 'decided',
      verdict,
      winner: verdict === 'yes' ? 'angel' : 'devil',
      decidedAt,
      updatedAt: decidedAt,
    } : current));
    setDialogOpen(false);
    setTranscriptOpen(false);
  }

  function restart() {
    abortActiveRequest();
    clearSpeakerHold();
    setDecision(null);
    setThinkingRole(null);
    setActiveReplyId(null);
    setIsReceiving(false);
    setDialogOpen(false);
    setTranscriptOpen(false);
  }

  function openHistoryDecision(nextDecision: Decision) {
    abortActiveRequest();
    clearSpeakerHold();
    setDecision(nextDecision);
    setThinkingRole(null);
    setActiveReplyId(null);
    setIsReceiving(false);
    setDialogOpen(false);
    setTranscriptOpen(false);
    setHistoryOpen(false);
  }

  function characterState(role: Role): CharacterState {
    return resolveCharacterState({
      role,
      verdict: decision?.verdict || null,
      activeRole: thinkingRole,
      isReceiving,
      lastSpeaker,
    }) as CharacterState;
  }

  if (!isHydrated) {
    return (
      <StartScreen
        historyCount={0}
        onHistory={() => setHistoryOpen(true)}
        onStart={startDecision}
      />
    );
  }

  const historyDialog = (
    <HistoryDialog
      decisions={history}
      open={historyOpen}
      onOpenChange={setHistoryOpen}
      onOpenDecision={openHistoryDecision}
    />
  );
  const storageWarning = storageError ? (
    <output className="storage-warning">
      浏览器暂时无法保存记录，本次对话仍可继续。
    </output>
  ) : null;

  if (!decision) {
    return (
      <>
        <StartScreen
          historyCount={history.length}
          onHistory={() => setHistoryOpen(true)}
          onStart={startDecision}
        />
        {historyDialog}
        {storageWarning}
      </>
    );
  }

  function latestReply(role: Role): { reply: Reply; turnId: string } | null {
    if (!decision) return null;
    for (let turnIndex = decision.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const turn = decision.turns[turnIndex];
      for (let replyIndex = turn.responses.length - 1; replyIndex >= 0; replyIndex -= 1) {
        const reply = turn.responses[replyIndex];
        if (reply.role === role) return { reply, turnId: turn.id };
      }
    }
    return null;
  }

  const angelReply = latestReply('angel');
  const devilReply = latestReply('devil');

  return (
    <>
      <main className="stage-shell" id="main">
        <AppHeader
          title={decision.title}
          turnCount={decision.turns.length}
          historyCount={history.length}
          onHistory={() => setHistoryOpen(true)}
          onDecide={() => setDialogOpen(true)}
        />
        <div className="duel-stage">
          <CharacterPanel side="angel" state={characterState('angel')} reply={angelReply?.reply || null} turnId={angelReply?.turnId || null} isThinking={thinkingRole === 'angel'} onRetry={retryReply} />
          <CharacterPanel side="devil" state={characterState('devil')} reply={devilReply?.reply || null} turnId={devilReply?.turnId || null} isThinking={thinkingRole === 'devil'} onRetry={retryReply} />
          <Composer disabled={Boolean(thinkingRole || decision.verdict)} onSummon={summon} onNewTurn={addTurn} onHistory={() => setTranscriptOpen(true)} onDecide={() => setDialogOpen(true)} />
        </div>

        <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
          <DialogContent className="transcript-dialog">
            <DialogHeader>
              <span className="dialog-kicker"><MessageCircleMore /> CONVERSATION</span>
              <DialogTitle>完整对话</DialogTitle>
              <DialogDescription>这里保留每一轮提问和双方的全部回复。</DialogDescription>
            </DialogHeader>
            <Conversation turns={decision.turns} activeReplyId={activeReplyId} onRetry={retryReply} />
          </DialogContent>
        </Dialog>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="verdict-dialog" showCloseButton={false}>
            <DialogHeader>
              <span className="dialog-kicker"><Gavel /> FINAL VERDICT</span>
              <DialogTitle>这一局，你决定怎么做？</DialogTitle>
              <DialogDescription>角色已经说完自己的立场。最终选择只属于你。</DialogDescription>
            </DialogHeader>
            <div className="verdict-options">
              <button className="verdict-yes" onClick={() => settle('yes')}><Feather /><span><small>YES · 天使获胜</small>我决定去做</span><ChevronRight /></button>
              <button className="verdict-no" onClick={() => settle('no')}><Flame /><span><small>NO · 恶魔获胜</small>我决定不做</span><ChevronRight /></button>
            </div>
            <DialogClose className="continue-button"><X /> 我还想再听听</DialogClose>
          </DialogContent>
        </Dialog>

        {decision.verdict ? <ResultOverlay decision={decision} onRestart={restart} /> : null}
      </main>
      {historyDialog}
      {storageWarning}
    </>
  );
}
