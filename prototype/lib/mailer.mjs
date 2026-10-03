import nodemailer from 'nodemailer';

/**
 * 通过 SMTP 发送登录验证码（QQ 邮箱、163、阿里云邮件推送、企业邮箱等均可）。
 * 云服务器通常封禁 25 端口，默认走 465（SSL）。
 */

export class MailError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'MailError';
    this.status = status;
  }
}

export function mailSettings(env = process.env) {
  const mock = env.MAIL_MOCK === '1';
  if (mock && env.NODE_ENV === 'production') {
    throw new MailError('生产环境不能开启 MAIL_MOCK。', { status: 500 });
  }
  const port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER?.trim() ?? '';
  return {
    mock,
    host: env.SMTP_HOST?.trim() ?? '',
    port,
    // 465 为 SSL 直连；587 等端口先明文再 STARTTLS。
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' : port === 465,
    user,
    pass: env.SMTP_PASS?.trim() ?? '',
    from: env.MAIL_FROM?.trim() || (user ? `司命 <${user}>` : ''),
  };
}

let cached = null;
function transporter(settings) {
  const key = `${settings.host}:${settings.port}:${settings.user}`;
  if (cached?.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: { user: settings.user, pass: settings.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    };
  }
  return cached.transport;
}

export function loginMail(code, minutes) {
  return {
    subject: `司命 · 登录验证码 ${code}`,
    text: `你的登录验证码是 ${code}，${minutes} 分钟内有效。\n\n如果不是你本人操作，忽略这封邮件即可。\n\n—— 司命 · 问时`,
    html: `<div style="font-family:'Songti SC','Noto Serif SC',serif;color:#1b1a17;background:#f7f3ea;padding:28px 24px;max-width:420px">
<p style="margin:0 0 6px;font-size:14px;letter-spacing:.2em;color:#6e695f">司命 · 问时</p>
<p style="margin:0 0 18px;font-size:15px">你的登录验证码</p>
<p style="margin:0 0 18px;font-size:34px;letter-spacing:.35em;font-weight:600">${code}</p>
<p style="margin:0;font-size:13px;color:#6e695f;line-height:1.8">${minutes} 分钟内有效。如果不是你本人操作，忽略这封邮件即可。</p>
</div>`,
  };
}

/** 发送验证码邮件。 */
export async function sendLoginCode(email, code, minutes, settings = mailSettings(), transport = null) {
  if (settings.mock) {
    console.info(`[MAIL_MOCK] 未真实发信，${email} 的验证码为 ${code}`);
    return;
  }
  if (!settings.host || !settings.user || !settings.pass || !settings.from) {
    throw new MailError('邮件服务未配置。', { status: 503 });
  }
  try {
    await (transport ?? transporter(settings)).sendMail({ from: settings.from, to: email, ...loginMail(code, minutes) });
  } catch (error) {
    console.error('Mail send failed:', error.code ?? '', error.responseCode ?? '', error.message);
    // 收件地址被拒（不存在、拼错）时告诉用户检查邮箱。
    if (error.responseCode >= 550 && error.responseCode < 560) throw new MailError('邮件被退回，请检查邮箱地址。', { status: 400 });
    throw new MailError('邮件暂时发不出去，请稍后再试。');
  }
}
