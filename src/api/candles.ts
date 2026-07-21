/**
 * 일봉 조회. GET /api/v1/candles (interval=1d, 1회 최대 200개, before 로 과거 페이지네이션)
 */
import type { Candle } from '../engine/types.ts';
import { sleep, type Client } from './client.ts';

const PAGE_SIZE = 200;
/** MARKET_DATA_CHART 는 5 req/sec. 페이지 사이 여유. */
const PAGE_DELAY_MS = 250;

type ApiCandle = {
  timestamp: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
};

type CandlePage = { candles: ApiCandle[]; nextBefore: string | null };

/**
 * 봉 시작 시각 → 거래일.
 * 미확정: 응답 timestamp 의 타임존 표기를 실데이터로 확인하지 않았다.
 * UTC 자정 표기든 ET 장중 표기든 UTC 날짜가 거래일과 같아서 현재는 UTC 로 자른다.
 */
export function tradingDate(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function toCandle(c: ApiCandle): Candle {
  return {
    date: tradingDate(c.timestamp),
    open: c.openPrice,
    high: c.highPrice,
    low: c.lowPrice,
    close: c.closePrice,
  };
}

/**
 * `symbol` 의 일봉을 최신부터 과거로 훑어 `since` 이전까지 모은다.
 * 반환은 날짜 오름차순.
 *
 * @param since 이 날짜(YYYY-MM-DD) 이전 봉은 버린다. 생략하면 maxPages 만큼만 받는다.
 */
export async function fetchDailyCandles(
  client: Client,
  symbol: string,
  { since, maxPages = 20 }: { since?: string; maxPages?: number } = {},
): Promise<Candle[]> {
  const collected: Candle[] = [];
  let before: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await client.get<CandlePage>('/api/v1/candles', {
      symbol,
      interval: '1d',
      count: PAGE_SIZE,
      before,
    });

    const candles = result.candles.map(toCandle);
    collected.push(...candles);

    const oldest = candles.at(0)?.date ?? candles.at(-1)?.date;
    if (!result.nextBefore) break;
    if (since && oldest && oldest <= since) break;

    before = result.nextBefore;
    await sleep(PAGE_DELAY_MS);
  }

  const filtered = since ? collected.filter((c) => c.date >= since) : collected;
  return dedupeSorted(filtered);
}

/** 페이지 경계에서 같은 날짜가 겹칠 수 있어 날짜 기준으로 중복을 없앤다. */
function dedupeSorted(candles: Candle[]): Candle[] {
  const byDate = new Map(candles.map((c) => [c.date, c]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
