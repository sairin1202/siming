import { createHmac, randomUUID } from 'node:crypto';

/**
 * 阿里云号码认证服务 · 短信认证（Dypnsapi 2017-05-25）。
 * 验证码由阿里云生成、下发和校验，本服务不保存验证码。
 * 用 RPC 签名（HMAC-SHA1）直接调用，不引入 SDK。
 */

const ENDPOINT = 'https://dypnsapi.aliyuncs.com/';
const VERSION = '2017-05-25';
const TIMEOUT_MS = 10_000;

export const CODE_LENGTH = 6;
export const CODE_VALID_SECONDS = 300;
export const RESEND_SECONDS = 60;
/** 仅本地开发（SMS_MOCK=1）使用的固定验证码。 */
export const MOCK_CODE = '000000';

export class SmsError extends Error {
  constructor(message, { status = 502, code = null } = {}) {
    super(message);
    this.name = 'SmsError';
    this.status = status;
    this.code = code;
  }
}

/** RFC 3986 编码，阿里云签名要求的格式。 */
export function percentEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 按阿里云 RPC 规则给参数签名，返回带 Signature 的完整参数。 */
export function signParams(params, accessKeySecret, method = 'POST') {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(String(params[key]))}`)
    .join('&');
  const stringToSign = `${method}&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
  return { ...params, Signature: signature };
}

export function smsSettings(env = process.env) {
  const mock = env.SMS_MOCK === '1';
  if (mock && env.NODE_ENV === 'production') {
    throw new SmsError('生产环境不能开启 SMS_MOCK。', { status: 500 });
  }
  return {
    mock,
    accessKeyId: env.ALIYUN_ACCESS_KEY_ID?.trim() ?? '',
    accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET?.trim() ?? '',
    signName: env.ALIYUN_SMS_SIGN_NAME?.trim() ?? '',
    templateCode: env.ALIYUN_SMS_TEMPLATE_CODE?.trim() ?? '',
    schemeName: env.ALIYUN_SMS_SCHEME_NAME?.trim() ?? '',
  };
}

// 阿里云错误码 → 给用户看的话。未列出的统一说「稍后再试」。
const FRIENDLY = {
  'biz.FREQUENCY': '发送太频繁，请稍后再试。',
  'isv.BUSINESS_LIMIT_CONTROL': '今日发送次数已达上限，请明日再试。',
  'isv.MOBILE_NUMBER_ILLEGAL': '手机号无效。',
  'isv.DAY_LIMIT_CONTROL': '今日发送次数已达上限，请明日再试。',
};

async function call(action, params, settings, fetchImpl) {
  const { accessKeyId, accessKeySecret } = settings;
  if (!accessKeyId || !accessKeySecret) throw new SmsError('短信服务未配置。', { status: 503 });
  const signed = signParams(
    {
      Action: action,
      Version: VERSION,
      Format: 'JSON',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ...params,
    },
    accessKeySecret,
  );
  let payload;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(signed).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    payload = await response.json();
  } catch (error) {
    console.error(`Aliyun ${action} failed:`, error.message);
    throw new SmsError('短信服务暂时不可用，请稍后再试。');
  }
  if (payload?.Code !== 'OK') {
    console.error(`Aliyun ${action} returned ${payload?.Code}: ${payload?.Message} (${payload?.RequestId})`);
    throw new SmsError(FRIENDLY[payload?.Code] ?? '短信服务暂时不可用，请稍后再试。', {
      status: payload?.Code in FRIENDLY ? 429 : 502,
      code: payload?.Code ?? null,
    });
  }
  return payload;
}

/** 发送验证码。phone 为已校验的 11 位大陆手机号。 */
export async function sendVerifyCode(phone, settings = smsSettings(), fetchImpl = fetch) {
  if (settings.mock) {
    console.info(`[SMS_MOCK] 未真实发送短信，${phone} 的验证码为 ${MOCK_CODE}`);
    return;
  }
  if (!settings.signName || !settings.templateCode) throw new SmsError('短信服务未配置。', { status: 503 });
  await call(
    'SendSmsVerifyCode',
    {
      PhoneNumber: phone,
      CountryCode: '86',
      SignName: settings.signName,
      TemplateCode: settings.templateCode,
      TemplateParam: JSON.stringify({ code: '##code##', min: String(CODE_VALID_SECONDS / 60) }),
      CodeLength: CODE_LENGTH,
      CodeType: 1,
      ValidTime: CODE_VALID_SECONDS,
      Interval: RESEND_SECONDS,
      DuplicatePolicy: 1,
      ...(settings.schemeName ? { SchemeName: settings.schemeName } : {}),
    },
    settings,
    fetchImpl,
  );
}

/** 校验验证码，通过返回 true。 */
export async function checkVerifyCode(phone, code, settings = smsSettings(), fetchImpl = fetch) {
  if (settings.mock) return code === MOCK_CODE;
  const payload = await call(
    'CheckSmsVerifyCode',
    {
      PhoneNumber: phone,
      CountryCode: '86',
      VerifyCode: code,
      ...(settings.schemeName ? { SchemeName: settings.schemeName } : {}),
    },
    settings,
    fetchImpl,
  );
  return payload.Model?.VerifyResult === 'PASS';
}
