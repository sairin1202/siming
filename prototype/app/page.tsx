'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BirthCard,
  DaysCard,
  monthText,
  type CardData,
  type ChartCardData,
} from '@/components/siming/cards';
import { BirthForm, type BirthFormValue } from '@/components/siming/birth-form';
import { ChartCasting } from '@/components/siming/casting';
import { CastRitual, GuaFigure, type GuaCardData } from '@/components/siming/ritual';
import { Guide, type GuideMood } from '@/components/siming/guide';
import { LoginDialog, type Account } from '@/components/siming/login';
import { dropOnWater } from '@/components/siming/ripples';
import { InkScene } from '@/components/siming/scene';
import { InkWriting, toHanNumerals } from '@/components/siming/writing';

type Lean = { lean: 'go' | 'wait' | 'stop'; until: string | null; score: number };

type GuideState = {
  phase: 'question' | 'choose' | 'birth' | 'confirm' | 'cast' | 'reading' | 'decided';
  question: string | null;
  topic: string | null;
  horizon: number;
  birth: Record<string, unknown>;
  readings: number;
  lean: Lean | null;
  cast?: number[] | null;
  mode?: Mode | null;
};

/** 起卦 (cast a hexagram) or 观命 (read the birth chart). */
type Mode = 'gua' | 'ming';
const MODE_LABELS: Record<Mode, string> = { gua: '起卦', ming: '观命' };

/** Shown in place of a result when the visitor has not signed in. */
type LoginCardData = { kind: 'login' };

type Message = {
  id: string;
  from: 'guide' | 'user';
  text?: string;
  card?: CardData | LoginCardData;
  streaming?: boolean;
  error?: boolean;
};

type Birth = { date: string; time: string | null; gender: 'male' | 'female'; place?: string; longitude?: number };

type DecisionRecord = {
  id: string;
  question: string;
  lean: Lean['lean'] | null;
  choice: 'go' | 'stop';
  days: string[];
  at: string;
  outcome?: 'good' | 'okay' | 'bad';
  /** 本卦, or 本卦之之卦 when lines changed. */
  gua?: string;
  mode?: Mode;
  /** What the guide said before the choice. */
  reading?: string;
};

type GuideEvent =
  | { type: 'state'; state: GuideState }
  | { type: 'profile'; birth: Birth }
  | { type: 'say'; text: string }
  | { type: 'card'; card: CardData }
  | { type: 'start' }
  | { type: 'delta'; content: string }
  | { type: 'end' }
  | { type: 'done' }
  | { type: 'auth' }
  | { type: 'error'; message: string };

type SendBody = {
  message?: string;
  action?: { type: string; choice?: string; birth?: BirthFormValue; tosses?: number[]; mode?: Mode };
};

const LOGIN_REASON = '卦辞与命理须验明来者方可示之。';

const GREETING = '夜阑人静\n君心有疑 不妨言之';
const INITIAL_STATE: GuideState = {
  phase: 'question',
  question: null,
  topic: null,
  horizon: 3,
  birth: {},
  readings: 0,
  lean: null,
  cast: null,
  mode: null,
};
const KEYS = { profile: 'siming.profile', session: 'siming.session', records: 'siming.records' };
const OUTCOMES = { good: '顺', okay: '平', bad: '逆' } as const;

type Verse = { key: string; echo: Message | null; items: Message[] };

/** What is on screen: everything the guide said since the user last spoke. */
function verseOf(messages: Message[]): Verse {
  const lastUser = messages.map((message) => message.from).lastIndexOf('user');
  const echo = lastUser >= 0 ? messages[lastUser] : null;
  return { key: echo?.id ?? 'opening', echo, items: messages.slice(lastUser + 1) };
}

const LEAVE_MS = 700;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
// The opening: a greeting, then the two ways in.
const greetingMessages = (): Message[] => [
  { id: newId(), from: 'guide', text: GREETING },
  { id: newId(), from: 'guide', card: { kind: 'modes' } },
];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the session still works in memory.
  }
}

async function requestRecords(init?: { method: 'POST' | 'PATCH'; body: unknown }) {
  const response = await fetch('/api/records', {
    method: init?.method ?? 'GET',
    headers: init ? { 'Content-Type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) throw new Error(`records ${response.status}`);
  return (await response.json()) as { records?: DecisionRecord[] };
}

function birthSummary(birth: Birth) {
  const [year, month, day] = birth.date.split('-').map(Number);
  return toHanNumerals(
    `${year}年${month}月${day}日 ${birth.time ? `${'子丑寅卯辰巳午未申酉戌亥'[Math.floor((Number(birth.time.slice(0, 2)) + 1) / 2) % 12]}时` : '时辰不详'} ${birth.gender === 'male' ? '乾造' : '坤造'}${birth.place ? ` ${birth.place}` : ''}`,
  );
}

function recordDate(at: string) {
  const date = new Date(at);
  return toHanNumerals(`${date.getMonth() + 1}月${date.getDate()}日`);
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>(greetingMessages);
  const [state, setState] = useState<GuideState>(INITIAL_STATE);
  const [profile, setProfile] = useState<Birth | null>(null);
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [panel, setPanel] = useState<'records' | 'profile' | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // undefined while the session is being checked.
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [loginOpen, setLoginOpen] = useState(false);
  // The request that was held back for sign-in; sent again once signed in.
  const pendingRef = useRef<SendBody | null>(null);
  // Read when saving a record, which may happen in a retry sent right after sign-in.
  const accountRef = useRef<Account | null | undefined>(undefined);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  const [casting, setCasting] = useState<ChartCardData | null>(null);
  // The coin-casting ritual: open while the user stills, throws and watches the hexagram form.
  const [ritualOpen, setRitualOpen] = useState(false);
  const [ritualGua, setRitualGua] = useState<GuaCardData | null>(null);
  // After a decision, mist drifts over the painting once.
  const [farewell, setFarewell] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Verse | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Let the current verse fade out while the next one inks in.
  const fadeOut = useCallback((verse: Verse) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setLeaving(verse);
    leaveTimer.current = setTimeout(() => setLeaving(null), LEAVE_MS);
  }, []);
  const abortRef = useRef<AbortController | null>(null);

  // Browser storage is only readable after hydration.
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler
    setProfile(load<Birth | null>(KEYS.profile, null));
    setRecords(load<DecisionRecord[]>(KEYS.records, []));
    const session = load<{ messages: Message[]; state: GuideState; pending?: SendBody | null } | null>(KEYS.session, null);
    pendingRef.current = session?.pending ?? null;
    if (session?.messages?.length) {
      // The restored verse is brushed again from the first stroke.
      setMessages(session.messages.filter((message) => !message.streaming));
      setState(session.state);
    }
    setHydrated(true);
  }, []);

  /** Bring this device's records into the account, then show the account's. */
  const syncRecords = useCallback(async () => {
    const local = load<DecisionRecord[]>(KEYS.records, []);
    try {
      const result = local.length
        ? await requestRecords({ method: 'POST', body: { records: local } })
        : await requestRecords();
      if (local.length) save(KEYS.records, null);
      setRecords(result.records ?? []);
    } catch {
      // Keep showing what this device has; the next sign-in tries again.
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => (response.ok ? (response.json() as Promise<{ user: Account | null }>) : { user: null }))
      .then(({ user }) => {
        setAccount(user);
        if (user) void syncRecords();
      })
      .catch(() => setAccount(null));
  }, [syncRecords]);

  useEffect(() => {
    if (hydrated && !busy) save(KEYS.session, { messages, state, pending: pendingRef.current });
  }, [messages, state, busy, hydrated]);

  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: scrolledOnce.current ? 'smooth' : 'auto',
    });
    scrolledOnce.current = true;
  }, [messages, hydrated]);

  // While the guide is divining, drops keep falling near the centre.
  useEffect(() => {
    if (!busy || streaming) return;
    const timer = setInterval(
      () => dropOnWater(0.35 + Math.random() * 0.3, 0.5 + Math.random() * 0.25, 0.8),
      1300,
    );
    return () => clearInterval(timer);
  }, [busy, streaming]);

  const mood: GuideMood = casting
    ? 'divining'
    : streaming
    ? 'speaking'
    : busy
      ? 'divining'
      : input.trim()
        ? 'listening'
        : state.phase === 'decided'
          ? 'farewell'
          : 'idle';

  const send = useCallback(
    async (body: SendBody, display?: string) => {
      if (busy) return;
      const history = messages
        .filter((message) => message.text && !message.error)
        .map((message) => ({ from: message.from, text: message.text! }));
      if (display) {
        dropOnWater(0.5, 0.9, 0.9);
        fadeOut(verseOf(messages));
        setMessages((current) => [...current, { id: newId(), from: 'user', text: display }]);
      }
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let streamingId: string | null = null;
      let spoke = false;
      let pickedDays: string[] = [];
      let needsLogin = false;

      const apply = (event: GuideEvent) => {
        switch (event.type) {
          case 'state':
            setState(event.state);
            break;
          case 'profile':
            setProfile(event.birth);
            save(KEYS.profile, event.birth);
            break;
          case 'say':
            if (!spoke) dropOnWater(0.5, 0.62, 0.9);
            spoke = true;
            setMessages((current) => [...current, { id: newId(), from: 'guide', text: event.text }]);
            break;
          case 'card':
            if (event.card.kind === 'gua') setRitualGua(event.card);
            if (event.card.kind === 'days') pickedDays = event.card.days.map((day) => day.date);
            if (event.card.kind === 'chart' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
              setCasting(event.card);
            }
            setMessages((current) => [...current, { id: newId(), from: 'guide', card: event.card }]);
            break;
          case 'start': {
            if (!spoke) dropOnWater(0.5, 0.62, 0.9);
            spoke = true;
            const id = newId();
            streamingId = id;
            setStreaming(true);
            setMessages((current) => [...current, { id, from: 'guide', text: '', streaming: true }]);
            break;
          }
          case 'delta': {
            const id = streamingId;
            setMessages((current) =>
              current.map((message) =>
                message.id === id ? { ...message, text: (message.text ?? '') + event.content } : message,
              ),
            );
            break;
          }
          case 'end': {
            const id = streamingId;
            streamingId = null;
            setStreaming(false);
            setMessages((current) =>
              current.map((message) => (message.id === id ? { ...message, streaming: false } : message)),
            );
            break;
          }
          case 'auth':
            needsLogin = true;
            pendingRef.current = body;
            setAccount(null);
            setLoginOpen(true);
            setMessages((current) => [
              ...current,
              { id: newId(), from: 'guide', text: '天机不可轻示\n验明来者 方见其辞' },
              { id: newId(), from: 'guide', card: { kind: 'login' } },
            ]);
            break;
          case 'error':
            setMessages((current) => [...current, { id: newId(), from: 'guide', text: event.message, error: true }]);
            break;
        }
      };

      try {
        const response = await fetch('/api/guide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, state, profile, history }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          apply({ type: 'error', message: payload?.error ?? '灯灭了一瞬，请再说一次。' });
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            if (!chunk.startsWith('data:')) continue;
            apply(JSON.parse(chunk.slice(5)) as GuideEvent);
          }
        }
        if (body.action?.type === 'decide' && state.question && !needsLogin) {
          setFarewell(true);
          const lastGua = [...messages].reverse().find((message) => message.card?.kind === 'gua')?.card;
          const reading = [...messages].reverse().find((message) => message.from === 'guide' && message.text?.trim() && !message.error)?.text;
          const record: DecisionRecord = {
            id: newId(),
            question: state.question,
            lean: state.lean?.lean ?? null,
            choice: body.action.choice === 'go' ? 'go' : 'stop',
            days: pickedDays,
            at: new Date().toISOString(),
            mode: state.mode ?? undefined,
            gua:
              lastGua?.kind === 'gua'
                ? `${lastGua.present.name}${lastGua.future ? `之${lastGua.future.name}` : ''}`
                : undefined,
            reading: reading?.slice(0, 2_000),
          };
          setRecords((current) => [record, ...current].slice(0, 200));
          // Signed in: kept with the account. Otherwise (or if saving fails) on this device.
          const keepLocally = () => save(KEYS.records, [record, ...load<DecisionRecord[]>(KEYS.records, [])].slice(0, 50));
          if (accountRef.current) requestRecords({ method: 'POST', body: { records: [record] } }).catch(keepLocally);
          else keepLocally();
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          apply({ type: 'error', message: '连不上了，请稍后再说一次。' });
        }
      } finally {
        setBusy(false);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [busy, messages, profile, state, fadeOut],
  );

  // The latest `send`, for retrying after sign-in from a stale closure.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onSignedIn = (signedIn: Account) => {
    accountRef.current = signedIn;
    setAccount(signedIn);
    setLoginOpen(false);
    void syncRecords();
    const pending = pendingRef.current;
    pendingRef.current = null;
    setMessages((current) => current.filter((message) => message.card?.kind !== 'login'));
    // Wait a tick so `send` sees the signed-in account and the cleared verse.
    if (pending) setTimeout(() => void sendRef.current(pending), 0);
  };

  const closeLogin = () => {
    setLoginOpen(false);
    // A cast waiting on sign-in can be thrown again later.
    if (pendingRef.current?.action?.type === 'cast') setRitualOpen(false);
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setAccount(null);
    setRecords(load<DecisionRecord[]>(KEYS.records, []));
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void send({ message: text }, text);
  };

  const restart = () => {
    abortRef.current?.abort();
    pendingRef.current = null;
    fadeOut(verseOf(messages));
    setMessages(greetingMessages());
    setState(INITIAL_STATE);
    setInput('');
  };

  const forgetProfile = () => {
    save(KEYS.profile, null);
    setProfile(null);
    setPanel(null);
    restart();
  };

  const markOutcome = (id: string, outcome: DecisionRecord['outcome']) => {
    setRecords((current) => current.map((record) => (record.id === id ? { ...record, outcome } : record)));
    if (account) {
      void requestRecords({ method: 'PATCH', body: { id, outcome } }).catch(() => null);
    } else {
      save(
        KEYS.records,
        load<DecisionRecord[]>(KEYS.records, []).map((record) => (record.id === id ? { ...record, outcome } : record)),
      );
    }
  };

  const verse = verseOf(messages);
  const lastBirthCardId = [...messages]
    .reverse()
    .find((message) => message.card?.kind === 'birth' || message.card?.kind === 'birth-form')?.id;
  const canDecide = state.phase === 'reading' && !busy;
  const goLabel =
    state.lean?.lean === 'wait' && state.lean.until ? `待到${monthText(state.lean.until)}再行` : '行';

  return (
    <main className="shell">
      <InkScene />

      <header className="topbar">
        <button type="button" className="brand" onClick={restart} aria-label="开始新的问事">
          <span className="brand-mark" aria-hidden="true" />
          <span>司命<small>问时</small></span>
        </button>
        <nav>
          <button type="button" className="icon-button" onClick={() => setPanel('records')} aria-label="回看">
            录
          </button>
          <button type="button" className="icon-button" onClick={() => setPanel('profile')} aria-label="我的生辰">
            辰
          </button>
        </nav>
      </header>

      <section className="stage">
        <div className="stage-guide">
          <Guide mood={mood} />
        </div>

        <div className="verse-area">
          <div className="verse-stack">
            <div className="verse-scroll" ref={scrollRef} aria-live="polite">
              <VerseView
                key={verse.key}
                verse={verse}
                entering={Boolean(leaving)}
                birthActive={(id) =>
                  id === lastBirthCardId && (state.phase === 'confirm' || state.phase === 'birth') && !busy
                }
                thinking={busy}
                paused={ritualOpen}
                castActive={state.phase === 'cast' && !busy}
                modesActive={(state.phase === 'question' || state.phase === 'choose' || state.phase === 'decided') && !busy}
                onPickMode={(mode) => void send({ action: { type: 'mode', mode } }, MODE_LABELS[mode])}
                onStartCast={() => {
                  setRitualGua(null);
                  setRitualOpen(true);
                }}
                onConfirm={() => void send({ action: { type: 'confirm_birth' } }, '是的')}
                onEdit={() => void send({ action: { type: 'edit_birth' } }, '要改')}
                onBirthSubmit={(birth, summary) => void send({ action: { type: 'submit_birth', birth } }, summary)}
                onLogin={() => setLoginOpen(true)}
              />
            </div>
            {leaving && (
              <div className="verse-leaving" aria-hidden="true">
                <VerseView verse={leaving} entering={false} instant birthActive={() => false} thinking={false} />
              </div>
            )}
          </div>

          <div className="whisper">
            {canDecide && (
              <div className="decide">
                <button
                  type="button"
                  className="decide-go"
                  onClick={() => void send({ action: { type: 'decide', choice: 'go' } }, goLabel)}
                >
                  {goLabel}
                </button>
                <span className="decide-or" aria-hidden="true">或</span>
                <button
                  type="button"
                  className="decide-stop"
                  onClick={() => void send({ action: { type: 'decide', choice: 'stop' } }, '止')}
                >
                  止
                </button>
              </div>
            )}
            <form
              className="answer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                maxLength={500}
                placeholder={
                  state.phase === 'reading'
                    ? state.mode === 'ming'
                      ? '还想问什么？比如「看半年」'
                      : '还想问什么？'
                    : state.phase === 'birth' || state.phase === 'confirm'
                      ? '于生辰帖上择定即可'
                      : state.phase === 'choose'
                        ? '择一而观，或直言「起卦」「观命」'
                        : state.phase === 'cast'
                          ? '心有所问 先掷其钱'
                          : '说说让你拿不定主意的事…'
                }
                aria-label="对司命说"
              />
              <button type="submit" className="answer-send" disabled={!input.trim() || busy} aria-label="说出">
                答
              </button>
            </form>
            <p className="footnote">命理只是看问题的一个角度，决定在你。</p>
          </div>
        </div>
      </section>

      {casting && <ChartCasting card={casting} onDone={() => setCasting(null)} />}
      {ritualOpen && (
        <CastRitual
          gua={ritualGua}
          onCast={(tosses) => void send({ action: { type: 'cast', tosses } }, '掷钱六次')}
          onClose={() => setRitualOpen(false)}
        />
      )}
      {loginOpen && <LoginDialog reason={LOGIN_REASON} onDone={onSignedIn} onClose={closeLogin} />}
      {farewell && (
        <video
          className="scene-moment"
          src="/videos/farewell.mp4"
          autoPlay
          muted
          playsInline
          onEnded={() => setFarewell(false)}
          onError={() => setFarewell(false)}
        />
      )}

      {panel && (
        <>
          <button type="button" className="drawer-backdrop" onClick={() => setPanel(null)} aria-label="关闭" />
          <aside className="drawer" aria-label={panel === 'records' ? '回看' : '我的生辰'}>
            <div className="drawer-head">
              <h2>{panel === 'records' ? '所问之录' : '生辰'}</h2>
              <button type="button" className="icon-button" onClick={() => setPanel(null)} aria-label="关闭">
                收
              </button>
            </div>
            {panel === 'profile' ? (
              profile ? (
                <div className="drawer-body">
                  <p className="profile-line">{birthSummary(profile)}</p>
                  <p className="muted">生辰只存于此机，用以推演，不作他用。</p>
                  <button type="button" className="ink-link" onClick={forgetProfile}>
                    忘却生辰
                  </button>
                </div>
              ) : (
                <div className="drawer-body">
                  <p className="muted">尚未记下生辰。观命之时，司命自会相问。</p>
                </div>
              )
            ) : (
              <div className="drawer-body">
                {account ? (
                  <p className="account-line">
                    {account.email} 所问之录随账号保存
                    <button type="button" className="ink-link" onClick={() => void signOut()}>
                      退出
                    </button>
                  </p>
                ) : account === null ? (
                  <p className="account-line">
                    所问之录暂存此机，登录后随账号保存
                    <button type="button" className="ink-link" onClick={() => setLoginOpen(true)}>
                      登录
                    </button>
                  </p>
                ) : null}
                {records.length === 0 && <p className="muted">尚无所问。</p>}
                <ul className="records">
                  {records.map((record) => (
                    <li key={record.id}>
                      <p className="record-question">{record.question}</p>
                      <span className={`record-choice ${record.choice === 'go' ? 'is-go' : ''}`} aria-label={record.choice === 'go' ? '择行' : '择止'}>
                        {record.choice === 'go' ? '行' : '止'}
                      </span>
                      <p className="record-meta">
                        {recordDate(record.at)}
                        {record.mode ? ` · ${MODE_LABELS[record.mode]}` : ''}
                        {record.gua ? ` · ${record.gua}` : ''}
                        {record.lean ? ` · ${{ go: '宜行', wait: '待时', stop: '宜止' }[record.lean]}` : ''}
                      </p>
                      {record.reading && (
                        <details className="record-reading">
                          <summary>司命之辞</summary>
                          <p>{record.reading}</p>
                        </details>
                      )}
                      <div className="record-outcome">
                        <span>其后</span>
                        {(Object.keys(OUTCOMES) as Array<keyof typeof OUTCOMES>).map((key) => (
                          <button
                            key={key}
                            type="button"
                            className={`record-mark ${record.outcome === key ? 'is-on' : ''}`}
                            onClick={() => markOutcome(record.id, key)}
                          >
                            {OUTCOMES[key]}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" className="ink-link drawer-restart" onClick={() => { setPanel(null); restart(); }}>
              另问一事
            </button>
          </aside>
        </>
      )}
    </main>
  );
}

/**
 * One question (or reading) at a time, centred. The guide's words are
 * brush-written in vertical columns; any cards follow once the writing ends.
 */
function VerseView({
  verse,
  entering,
  birthActive,
  thinking,
  paused = false,
  castActive = false,
  onStartCast = () => {},
  modesActive = false,
  onPickMode = () => {},
  instant = false,
  onConfirm = () => {},
  onEdit = () => {},
  onBirthSubmit = () => {},
  onLogin = () => {},
}: {
  verse: Verse;
  entering: boolean;
  birthActive: (id: string) => boolean;
  thinking: boolean;
  /** Hold the brush while the casting ritual covers the page. */
  paused?: boolean;
  castActive?: boolean;
  onStartCast?: () => void;
  modesActive?: boolean;
  onPickMode?: (mode: Mode) => void;
  instant?: boolean;
  onConfirm?: () => void;
  onEdit?: () => void;
  onBirthSubmit?: (birth: BirthFormValue, summary: string) => void;
  onLogin?: () => void;
}) {
  const [written, setWritten] = useState(instant);
  const textMessages = verse.items.filter((message) => !message.card && message.text?.trim());
  const text = textMessages
    .map((message) =>
      (message.text ?? '')
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .join('\n\n'),
    )
    .join('\n\n');
  const streaming = verse.items.some((message) => message.streaming);
  const failed = textMessages.some((message) => message.error);
  // The chart only feeds the casting animation; it isn't laid out as a card.
  const cards = verse.items.filter((message) => message.card && message.card.kind !== 'chart');
  const showCards = (written || !text) && cards.length > 0;
  const cardsRef = useRef<HTMLDivElement>(null);

  // Cards arrive after the brush stops; bring them into view on small screens.
  useEffect(() => {
    if (showCards && !instant) cardsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [showCards, instant]);

  return (
    <div
      className={`verse ${entering ? 'is-entering' : ''} ${failed ? 'is-error' : ''} ${cards.length ? 'has-cards' : ''}`}
    >
      {text && (
        <InkWriting
          text={text}
          streaming={streaming}
          instant={instant}
          hold={thinking || paused}
          startDelay={entering ? 520 : 0}
          onDone={() => setWritten(true)}
        />
      )}
      {/* The brush waits for the whole reply so its layout is final before the first stroke. */}
      {thinking && (
        <div className="verse-thinking" aria-label="司命正在推演">
          <span />
          <span />
          <span />
        </div>
      )}
      {showCards && (
        <div className="verse-cards" ref={cardsRef}>
          {cards.map(({ id, card }) => (
            <div key={id} className="verse-card">
              {card?.kind === 'birth-form' && (
                <BirthForm card={card} active={birthActive(id)} onSubmit={onBirthSubmit} />
              )}
              {card?.kind === 'birth' && (
                <BirthCard card={card} active={birthActive(id)} onConfirm={onConfirm} onEdit={onEdit} />
              )}
              {card?.kind === 'days' && <DaysCard card={card} />}
              {card?.kind === 'modes' && (
                <div className="mode-choice">
                  <button type="button" className="mode-seal" disabled={!modesActive} onClick={() => onPickMode('gua')}>
                    起卦
                    <small>一事一问 掷钱成卦</small>
                  </button>
                  <button type="button" className="mode-seal is-light" disabled={!modesActive} onClick={() => onPickMode('ming')}>
                    观命
                    <small>依其生辰 观其时运</small>
                  </button>
                </div>
              )}
              {card?.kind === 'login' && (
                <div className="login-invite">
                  <button type="button" className="cast-invite" disabled={instant} onClick={onLogin}>
                    验明
                  </button>
                </div>
              )}
              {card?.kind === 'cast' && (
                <button type="button" className="cast-invite" disabled={!castActive} onClick={onStartCast}>
                  起卦
                </button>
              )}
              {card?.kind === 'gua' && (
                <div className="verse-gua">
                  <GuaFigure tosses={card.tosses} size={64} />
                  <p>
                    {card.present.name}
                    {card.future && `之${card.future.name}`}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
