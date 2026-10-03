'use client';

import { useEffect, useRef, useState } from 'react';

export type Account = { email: string };

const PASSWORD_MIN = 8;

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

/** 邮箱与密码登录；初来者在此注册。 */
export function LoginDialog({
  reason,
  onDone,
  onClose,
}: {
  /** 为何要登录，写在标题下。 */
  reason: string;
  /** `birth` is the account's saved birth, or null. */
  onDone: (account: Account, birth: unknown) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => emailRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const registering = mode === 'register';
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready =
    emailValid && (registering ? password.length >= PASSWORD_MIN && confirm.length > 0 : password.length > 0);

  const switchMode = () => {
    setMode(registering ? 'login' : 'register');
    setConfirm('');
    setError(null);
  };

  const submit = async () => {
    if (!ready || pending) return;
    if (registering && password !== confirm) {
      setError('两次输入的密码不一致。');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await post<{ user: Account; birth?: unknown }>(registering ? '/api/auth/register' : '/api/auth/login', {
        email: email.trim(),
        password,
      });
      onDone(result.user, result.birth ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" className="login-backdrop" onClick={onClose} aria-label="关闭" />
      <dialog open className="login" aria-modal="true" aria-labelledby="login-title">
        <h2 id="login-title">{registering ? '初来留名' : '验明来者'}</h2>
        <p className="muted">{reason}</p>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="login-field">
            <span>邮箱</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value.slice(0, 254))}
              inputMode="email"
              autoComplete={registering ? 'email' : 'username'}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              aria-label="邮箱"
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value.slice(0, 128))}
              autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder={registering ? `至少 ${PASSWORD_MIN} 位` : ''}
              aria-label="密码"
            />
          </label>
          {registering && (
            <label className="login-field">
              <span>再输</span>
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value.slice(0, 128))}
                autoComplete="new-password"
                placeholder="再输一次密码"
                aria-label="确认密码"
              />
            </label>
          )}
          <p className="login-error" role="alert">
            {error}
          </p>
          <button type="submit" className="ink-link login-submit" disabled={!ready || pending}>
            {pending ? '稍候' : registering ? '留名' : '入'}
          </button>
        </form>
        <p className="login-note">
          {registering ? '已有账号？' : '初来此处？'}
          <button type="button" className="login-switch" onClick={switchMode}>
            {registering ? '去登录' : '注册一个'}
          </button>
        </p>
        <p className="login-note">生辰与所问之录随账号保存。密码暂不能找回，请记牢。</p>
      </dialog>
    </>
  );
}

/** After sign-in: this device still holds a birth or records with no account. Ask before merging them. */
export function StrayDialog({
  birth,
  records,
  onChoose,
}: {
  birth: boolean;
  records: number;
  onChoose: (merge: boolean) => void;
}) {
  const what = [birth && '一份生辰', records > 0 && `${records} 条所问`].filter(Boolean).join('与');
  return (
    <>
      <div className="login-backdrop" aria-hidden="true" />
      <dialog open className="login" aria-modal="true" aria-labelledby="stray-title">
        <h2 id="stray-title">此机旧录</h2>
        <p className="muted">此机尚存{what}，未归于任何账号，或为他人所留。</p>
        <div className="login-actions">
          <button type="button" className="ink-link" onClick={() => onChoose(true)}>
            并入此账号
          </button>
          <button type="button" className="ink-link" onClick={() => onChoose(false)}>
            舍去
          </button>
        </div>
      </dialog>
    </>
  );
}
