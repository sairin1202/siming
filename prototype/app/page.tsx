'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Feather,
  Flame,
  Gavel,
  MessageCircleMore,
  RotateCcw,
  Send,
  Sparkles,
  Swords,
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

type Role = 'angel' | 'devil';
type CharacterState = 'idle' | 'thinking' | 'speaking' | 'listening' | 'victory' | 'defeat';
type Verdict = 'yes' | 'no';

type Reply = {
  id: string;
  role: Role;
  content: string;
};

type Turn = {
  id: string;
  userMessage: string;
  responses: Reply[];
};

type Decision = {
  title: string;
  turns: Turn[];
  verdict: Verdict | null;
};

const poseIndex: Record<CharacterState, number> = {
  idle: 0,
  thinking: 2,
  speaking: 1,
  listening: 2,
  victory: 3,
  defeat: 4,
};

const stateLabel: Record<CharacterState, string> = {
  idle: '等待召唤',
  thinking: '正在思考',
  speaking: '刚刚发言',
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

function focusOf(message: string) {
  const trimmed = message.trim().replace(/[？?。！!]+$/, '');
  return trimmed.length > 25 ? `${trimmed.slice(0, 25)}…` : trimmed;
}

function buildMockReply(role: Role, message: string, index: number, heardOther: boolean) {
  const focus = focusOf(message);
  const angelReplies = [
    `我会先问：如果「${focus}」真的值得，你能不能把它缩成一个可逆的小实验？先试一小步，不等于把所有筹码都押上。`,
    heardOther
      ? `风险当然存在，但风险不是自动放弃的理由。给自己设一个明确的退出条件，再争取一次真实反馈，你会比一直想象更接近答案。`
      : `你已经为这件事停下来认真衡量，说明它对你有真实吸引力。与其等待百分之百确定，不如先确定最小投入和验收点。`,
    `从半年后的视角看，最可能遗憾的也许不是一次不完美的尝试，而是从未验证过自己的判断。我的建议是：带着边界去做。`,
  ];
  const devilReplies = [
    `先别把“可以尝试”误当成“现在就该做”。围绕「${focus}」，你真正要付出的时间、注意力和放弃其他机会的成本，算清了吗？`,
    heardOther
      ? `天使提出了可逆试验，但“小试一下”也会占用精力。除非成功标准、截止时间和退出方式都能提前写下来，否则它很容易变成没有边界的承诺。`
      : `犹豫不一定是胆怯，也可能是信息不足。今天不答应并不代表永远拒绝；先补齐最关键的信息，暂停本身就是一种选择。`,
    `请做一个压力测试：如果结果比预期差一半，你仍愿意承担代价吗？如果答案是否定的，那就不要让乐观替你签字。`,
  ];
  const pool = role === 'angel' ? angelReplies : devilReplies;
  if (index < pool.length) return pool[index];

  const summonNumber = index + 1;
  return role === 'angel'
    ? `这是我第 ${summonNumber} 次为 Yes 辩护，所以不再重复“试试看”。请为「${focus}」写下最小行动、最晚复盘时间和一个停止条件。三项都能写清，我仍支持你去做；写不清，就先补信息。`
    : `这是我第 ${summonNumber} 次为 No 辩护，我不想只重复“有风险”。请为「${focus}」列出一项不可逆成本、一项被挤占的事和一个你仍未确认的事实。只要其中一项说不清，我就建议先不做。`;
}

function CharacterFigure({ role, state, compact = false }: { role: Role; state: CharacterState; compact?: boolean }) {
  const copy = roleCopy[role];

  return (
    <div
      className={`character-figure character-figure--${role} character-figure--${state}${compact ? ' character-figure--compact' : ''}`}
      style={{ '--pose': poseIndex[state] } as React.CSSProperties}
    >
      <div className="character-aura" aria-hidden="true" />
      <div className="character-rings" aria-hidden="true"><i /><i /><i /></div>
      <div className="character-sprite">
        <img src={`/characters/${role}-states.png`} alt={`${copy.name} · ${stateLabel[state]}`} />
      </div>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: (question: string, role: Role) => void }) {
  const [firstSpeaker, setFirstSpeaker] = useState<Role>('angel');
  const [question, setQuestion] = useState('');
  const [showError, setShowError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) {
      setShowError(true);
      return;
    }
    onStart(question.trim(), firstSpeaker);
  }

  return (
    <main className="start-shell">
      <div className="ambient ambient--gold" aria-hidden="true" />
      <div className="ambient ambient--red" aria-hidden="true" />
      <AppHeader room="01" />

      <section className="opening-stage" aria-labelledby="opening-title">
        <div className="intro-character intro-character--angel">
          <CharacterFigure role="angel" state="idle" />
          <CharacterCaption role="angel" />
        </div>

        <div className="opening-copy" id="decision">
          <div className="eyebrow"><Sparkles size={13} /> 一场只由你裁决的辩论</div>
          <h1 id="opening-title">让两个声音，<br /><em>把犹豫说清楚。</em></h1>
          <p className="opening-lead">天使替 Yes 辩护，恶魔替 No 发问。<br />他们负责说服，你负责决定。</p>

          <form className="decision-card" onSubmit={submit}>
            <label htmlFor="decision-question">你现在在纠结什么？</label>
            <Textarea
              id="decision-question"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                if (showError) setShowError(false);
              }}
              placeholder="例如：要不要接受一个很有挑战的新项目？"
              rows={3}
              aria-invalid={showError}
            />
            {showError && <p className="field-error">先写下你的问题，舞台才能开场。</p>}

            <fieldset>
              <legend>你想先听谁说？</legend>
              <div className="speaker-choice">
                <button type="button" className={`${firstSpeaker === 'angel' ? 'is-selected ' : ''}angel-choice`} onClick={() => setFirstSpeaker('angel')} aria-pressed={firstSpeaker === 'angel'}>
                  <Feather /> <span><small>YES</small>先听天使</span>
                </button>
                <button type="button" className={`${firstSpeaker === 'devil' ? 'is-selected ' : ''}devil-choice`} onClick={() => setFirstSpeaker('devil')} aria-pressed={firstSpeaker === 'devil'}>
                  <Flame /> <span><small>NO</small>先听恶魔</span>
                </button>
              </div>
            </fieldset>

            <Button type="submit" className="enter-stage" size="lg">开启决策舞台 <ArrowRight /></Button>
          </form>
          <p className="privacy-note"><span /> 你的选择不会由任何角色替你作出</p>
        </div>

        <div className="intro-character intro-character--devil">
          <CharacterFigure role="devil" state="idle" />
          <CharacterCaption role="devil" />
        </div>
      </section>
    </main>
  );
}

function AppHeader({ room = '01', title, turnCount, onDecide }: { room?: string; title?: string; turnCount?: number; onDecide?: () => void }) {
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
        {onDecide ? <Button onClick={onDecide} className="decide-button"><Gavel /> 作出决定</Button> : null}
        {!title ? <div className="round-badge"><span>DECISION ROOM</span><strong>{room}</strong></div> : null}
      </div>
    </header>
  );
}

function CharacterCaption({ role }: { role: Role }) {
  const copy = roleCopy[role];
  return (
    <div className={`character-caption character-caption--${role}`}>
      <span>{copy.camp}</span>
      <strong>{copy.name}</strong>
      <small>{copy.short}</small>
    </div>
  );
}

function CharacterPanel({ role, state, disabled, onSummon }: { role: Role; state: CharacterState; disabled: boolean; onSummon: () => void }) {
  const copy = roleCopy[role];
  return (
    <button className={`character-panel character-panel--${role} is-${state}`} onClick={onSummon} disabled={disabled} aria-label={`${copy.summon}，当前${stateLabel[state]}`}>
      <span className="panel-state"><i /> {stateLabel[state]}</span>
      <CharacterFigure role={role} state={state} />
      <CharacterCaption role={role} />
      <span className="summon-hint"><MessageCircleMore /> 点击角色 · {copy.summon}</span>
    </button>
  );
}

function Conversation({ turns, thinkingRole }: { turns: Turn[]; thinkingRole: Role | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, thinkingRole]);

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
            {turn.responses.map((reply) => (
              <article className={`agent-message agent-message--${reply.role}`} key={reply.id}>
                <div className="message-role">
                  <span>{reply.role === 'angel' ? <Feather /> : <Flame />}</span>
                  <strong>{roleCopy[reply.role].name}</strong>
                  <small>{roleCopy[reply.role].camp}</small>
                </div>
                <p>{reply.content}</p>
              </article>
            ))}
            {thinkingRole && turnIndex === turns.length - 1 ? (
              <div className={`thinking-message thinking-message--${thinkingRole}`}>
                <span /><span /><span /> {roleCopy[thinkingRole].name}正在整理观点
              </div>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function Composer({ disabled, onSummon, onNewTurn, onDecide }: { disabled: boolean; onSummon: (role: Role) => void; onNewTurn: (message: string, role: Role) => void; onDecide: () => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);

  function submitTo(role: Role) {
    if (!draft.trim()) {
      setError(true);
      return;
    }
    onNewTurn(draft.trim(), role);
    setDraft('');
    setError(false);
  }

  return (
    <div className="composer">
      <div className="current-turn-actions">
        <span>继续当前 Turn</span>
        <button onClick={() => onSummon('angel')} disabled={disabled}><Feather /> 再听天使</button>
        <button onClick={() => onSummon('devil')} disabled={disabled}><Flame /> 再听恶魔</button>
      </div>
      <div className="new-turn-box">
        <Textarea
          value={draft}
          onChange={(event) => { setDraft(event.target.value); if (error) setError(false); }}
          placeholder="补充新信息，开启下一个 Turn…"
          aria-label="补充新信息"
          aria-invalid={error}
          disabled={disabled}
        />
        <div className="send-options">
          {error ? <span className="composer-error">先写下你要补充的内容</span> : <span>发送给</span>}
          <Button onClick={() => submitTo('angel')} disabled={disabled} variant="ghost"><Feather /> 天使</Button>
          <Button onClick={() => submitTo('devil')} disabled={disabled} variant="ghost"><Flame /> 恶魔</Button>
          <Button onClick={onDecide} className="mobile-decide"><Gavel /> 作出决定</Button>
        </div>
      </div>
    </div>
  );
}

function ResultOverlay({ decision, onRestart }: { decision: Decision; onRestart: () => void }) {
  const winner: Role = decision.verdict === 'yes' ? 'angel' : 'devil';
  const loser: Role = winner === 'angel' ? 'devil' : 'angel';
  const allReplies = decision.turns.flatMap((turn) => turn.responses);
  const angelCount = allReplies.filter((reply) => reply.role === 'angel').length;
  const devilCount = allReplies.filter((reply) => reply.role === 'devil').length;

  return (
    <div className={`result-overlay result-overlay--${winner}`} role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className="result-rays" aria-hidden="true" />
      <div className="result-particles" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div>
      <div className="result-loser"><CharacterFigure role={loser} state="defeat" compact /></div>
      <div className="result-winner"><CharacterFigure role={winner} state="victory" /></div>
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
    </div>
  );
}

export default function Home() {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [thinkingRole, setThinkingRole] = useState<Role | null>(null);
  const [lastSpeaker, setLastSpeaker] = useState<Role | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function queueReply(role: Role, turnId: string, message: string, roleReplyIndex: number, heardOther: boolean) {
    setThinkingRole(role);
    setLastSpeaker(role);
    timerRef.current = window.setTimeout(() => {
      setDecision((current) => {
        if (!current || current.verdict) return current;
        return {
          ...current,
          turns: current.turns.map((turn) => turn.id === turnId
            ? { ...turn, responses: [...turn.responses, { id: makeId('reply'), role, content: buildMockReply(role, message, roleReplyIndex, heardOther) }] }
            : turn),
        };
      });
      setThinkingRole(null);
      timerRef.current = null;
    }, 900);
  }

  function startDecision(question: string, role: Role) {
    const turnId = makeId('turn');
    setDecision({ title: question, verdict: null, turns: [{ id: turnId, userMessage: question, responses: [] }] });
    queueReply(role, turnId, question, 0, false);
  }

  function summon(role: Role) {
    if (!decision || thinkingRole || decision.verdict) return;
    const turn = decision.turns[decision.turns.length - 1];
    const roleReplyIndex = turn.responses.filter((reply) => reply.role === role).length;
    const heardOther = turn.responses.some((reply) => reply.role !== role);
    queueReply(role, turn.id, turn.userMessage, roleReplyIndex, heardOther);
  }

  function addTurn(message: string, role: Role) {
    if (!decision || thinkingRole || decision.verdict) return;
    const turnId = makeId('turn');
    setDecision({ ...decision, turns: [...decision.turns, { id: turnId, userMessage: message, responses: [] }] });
    queueReply(role, turnId, message, 0, false);
  }

  function settle(verdict: Verdict) {
    if (!decision) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setThinkingRole(null);
    setDecision({ ...decision, verdict });
    setDialogOpen(false);
  }

  function restart() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setDecision(null);
    setThinkingRole(null);
    setLastSpeaker(null);
    setDialogOpen(false);
  }

  function characterState(role: Role): CharacterState {
    if (decision?.verdict) return (decision.verdict === 'yes' ? 'angel' : 'devil') === role ? 'victory' : 'defeat';
    if (thinkingRole === role) return 'thinking';
    if (thinkingRole && thinkingRole !== role) return 'listening';
    if (lastSpeaker === role) return 'speaking';
    if (lastSpeaker && lastSpeaker !== role) return 'listening';
    return 'idle';
  }

  if (!decision) return <StartScreen onStart={startDecision} />;

  return (
    <main className="stage-shell" id="main">
      <AppHeader title={decision.title} turnCount={decision.turns.length} onDecide={() => setDialogOpen(true)} />
      <div className="duel-stage">
        <CharacterPanel role="angel" state={characterState('angel')} disabled={Boolean(thinkingRole || decision.verdict)} onSummon={() => summon('angel')} />
        <section className="conversation-panel" aria-label="共享对话">
          <Conversation turns={decision.turns} thinkingRole={thinkingRole} />
          <Composer disabled={Boolean(thinkingRole || decision.verdict)} onSummon={summon} onNewTurn={addTurn} onDecide={() => setDialogOpen(true)} />
        </section>
        <CharacterPanel role="devil" state={characterState('devil')} disabled={Boolean(thinkingRole || decision.verdict)} onSummon={() => summon('devil')} />
      </div>

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
  );
}
