import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from './client.ts';
import { fetchDailyCandles, tradingDate } from './candles.ts';

const apiCandle = (date: string, close: number) => ({
  timestamp: `${date}T00:00:00Z`,
  openPrice: close,
  highPrice: close,
  lowPrice: close,
  closePrice: close,
  volume: 1000,
});

/** 페이지를 미리 정해두고 before 호출 순서대로 돌려주는 가짜 클라이언트 */
function fakeClient(pages: { candles: ReturnType<typeof apiCandle>[]; nextBefore: string | null }[]) {
  let calls = 0;
  const client: Client = {
    get: async <T,>() => pages[calls++] as T,
  };
  return { client, calls: () => calls };
}

test('봉 시작 시각을 거래일로 자른다', () => {
  assert.equal(tradingDate('2026-01-02T14:30:00Z'), '2026-01-02');
});

test('nextBefore 가 null 이면 페이지네이션을 멈춘다', async () => {
  const { client, calls } = fakeClient([
    { candles: [apiCandle('2026-01-02', 50)], nextBefore: null },
  ]);
  const result = await fetchDailyCandles(client, 'TQQQ');
  assert.equal(calls(), 1);
  assert.equal(result.length, 1);
});

test('since 이전까지 훑고 그보다 오래된 봉은 버린다', async () => {
  const { client } = fakeClient([
    { candles: [apiCandle('2026-01-03', 52)], nextBefore: '2026-01-02T00:00:00Z' },
    { candles: [apiCandle('2026-01-01', 49)], nextBefore: '2025-12-31T00:00:00Z' },
  ]);
  const result = await fetchDailyCandles(client, 'TQQQ', { since: '2026-01-02' });
  assert.deepEqual(
    result.map((c) => c.date),
    ['2026-01-03'],
  );
});

test('페이지가 겹쳐도 날짜 중복 없이 오름차순으로 합친다', async () => {
  const { client } = fakeClient([
    { candles: [apiCandle('2026-01-02', 50), apiCandle('2026-01-03', 52)], nextBefore: 'x' },
    { candles: [apiCandle('2026-01-01', 49), apiCandle('2026-01-02', 50)], nextBefore: null },
  ]);
  const result = await fetchDailyCandles(client, 'TQQQ');
  assert.deepEqual(
    result.map((c) => c.date),
    ['2026-01-01', '2026-01-02', '2026-01-03'],
  );
});
