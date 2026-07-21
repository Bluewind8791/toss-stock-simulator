/**
 * 토스증권 Open API 클라이언트.
 * 인증: OAuth 2.0 Client Credentials → Bearer access token.
 * 시뮬레이터는 읽기 전용이므로 주문 관련 엔드포인트는 다루지 않는다.
 */
const BASE_URL = 'https://openapi.tossinvest.com';

/** 토큰 만료 직전에 미리 갱신할 여유 (초) */
const REFRESH_MARGIN_SEC = 60;

export type Client = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) => Promise<T>;
};

type TokenResponse = { access_token: string; token_type: string; expires_in: number };

export function createClient(
  clientId = process.env.TOSS_CLIENT_ID,
  clientSecret = process.env.TOSS_CLIENT_SECRET,
): Client {
  if (!clientId || !clientSecret) {
    throw new Error('TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 가 필요합니다. .env 를 확인하세요.');
  }

  let token = '';
  let expiresAtMs = 0;

  async function accessToken(now: number): Promise<string> {
    if (token && now < expiresAtMs) return token;

    const res = await fetch(`${BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId!,
        client_secret: clientSecret!,
      }),
    });
    if (!res.ok) {
      throw new Error(`토큰 발급 실패 ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as TokenResponse;
    token = body.access_token;
    expiresAtMs = now + (body.expires_in - REFRESH_MARGIN_SEC) * 1000;
    return token;
  }

  async function get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    // 429 는 Retry-After 만큼 기다렸다 한 번만 재시도한다.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await accessToken(Date.now())}` },
      });
      if (res.status === 429 && attempt === 0) {
        const wait = Number(res.headers.get('Retry-After') ?? 1);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`GET ${url.pathname} 실패 ${res.status}: ${await res.text()}`);
      }
      // BFF 공통 응답 봉투: { result: ... }
      const body = (await res.json()) as { result: T };
      return body.result;
    }
  }

  return { get };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
