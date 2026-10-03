'use client';

import { useEffect, useRef, useState } from 'react';

export type Account = { email: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? '连不上了，请稍后再试。');
  return payload as T;
}

/** 邮箱验证码登录；首次登录即注册。 */
export function LoginDialog({
  reason,
  onDone,
  onClose,
}: {
  /** 为何要登录，写在标题下。 */
  reason: string;
  onDone: (account: Account) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [pending, setPending] = useState<'send' | 'login' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => emailRef.current?.focus(), []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendCode = async () => {
    if (!emailValid || wait > 0 || pending) return;
    setPending('send');
    setError(null);
    try {
      const result = await post<{ resendAfter: number }>('/api/auth/code', { email: email.trim() });
      setSentTo(email.trim());
      setWait(result.resendAfter);
      codeRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const login = async () => {
    if (!sentTo || code.length !== 6 || pending) return;
    setPending('login');
    setError(null);
    try {
      const result = await post<{ user: Account }>('/api/auth/login', { email: sentTo, code });
      onDone(result.user);
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      codeRef.current?.focus();
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <button type="button" className="login-backdrop" onClick={onClose} aria-label="关闭" />
      <dialog open className="login" aria-modal="true" aria-labelledby="login-title">
        <h2 id="login-title">验明来者</h2>
        <p className="muted">{reason}</p>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void (sentTo ? login() : sendCode());
          }}
        >
          <label className="login-field">
            <span>邮箱</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value.slice(0, 254));
                setSentTo(null);
                setCode('');
              }}
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              aria-label="邮箱"
            />
            <button type="button" className="login-send" disabled={!emailValid || wait > 0 || pending !== null} onClick={() => void sendCode()}>
              {pending === 'send' ? '发送中' : wait > 0 ? `${wait}秒` : sentTo ? '重发' : '取码'}
            </button>
          </label>
          <label className="login-field">
            <span>验证码</span>
            <input
              ref={codeRef}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={sentTo ? '六位数字' : '先取验证码'}
              disabled={!sentTo}
              aria-label="邮件验证码"
            />
          </label>
          <p className="login-error" role="alert">
            {error}
          </p>
          <button type="submit" className="ink-link login-submit" disabled={!sentTo || code.length !== 6 || pending !== null}>
            {pending === 'login' ? '验看中' : '入'}
          </button>
        </form>
        {sentTo && <p className="muted">验证码已寄往 {sentTo}，十分钟内有效；若未见，请看垃圾邮件。</p>}
        <p className="login-note">未注册的邮箱验证后自动注册。所问之录随账号保存。</p>
      </dialog>
    </>
  );
}
