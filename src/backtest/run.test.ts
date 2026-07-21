import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../engine/types.ts';
import { makeConfig } from '../engine/v4.ts';
import { backtest } from './run.ts';

/** 종가 배열을 시가=고가=저가=종가 인 캔들로. 날짜는 2026-01-01 부터 하루씩. */
function series(closes: number[]): Candle[] {
  return closes.map((close, i) => {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return { date, open: close, high: close, low: close, close };
  });
}

/** start 에서 end 까지 days 일에 걸쳐 직선으로 움직이는 종가 */
function ramp(start: number, end: number, days: number): number[] {
  return Array.from({ length: days }, (_, i) => start + ((end - start) * i) / (days - 1));
}

test('첫날은 전일 종가가 없어 매수하지 않는다', () => {
  const config = makeConfig('TQQQ', 40, 10_000);
  const result = backtest(series([50]), config);
  assert.equal(result.finalState.qty, 0);
  assert.equal(result.finalEquity, 10_000);
  assert.equal(result.cycles.length, 0);
});

test('하락 후 반등하면 사이클이 종료되고 수익이 남는다', () => {
  const config = makeConfig('TQQQ', 40, 10_000);
  const result = backtest(series([...ramp(50, 40, 30), ...ramp(40, 70, 30)]), config);

  assert.ok(result.cycles.length >= 1, '사이클이 최소 한 번 종료돼야 한다');
  for (const c of result.cycles) assert.ok(c.profit > 0, `사이클 수익이 양수: ${c.profit}`);
  assert.ok(result.finalEquity > config.seed);
  assert.ok(result.totalReturnPct > 0);
});

test('원금이 소진될 만큼 하락하면 리버스모드에 들어간다', () => {
  const config = makeConfig('TQQQ', 40, 10_000);
  const result = backtest(series(ramp(50, 5, 120)), config);

  assert.ok(
    result.days.some((d) => d.reverseDay > 0),
    '리버스모드에 진입한 날이 있어야 한다',
  );
  assert.ok(result.finalState.t > 0);
  assert.ok(result.maxDrawdownPct > 0);
});

test('단리는 사이클 종료마다 시드로 돌아가고 수익이 realized 에 쌓인다', () => {
  const config = makeConfig('TQQQ', 40, 10_000, false);
  const result = backtest(series([...ramp(50, 40, 30), ...ramp(40, 70, 30)]), config);

  assert.ok(result.cycles.length >= 1);
  assert.ok(result.finalState.realized > 0);
  // 단리에선 사이클 손익이 그대로 realized 에 쌓인다
  const sum = result.cycles.reduce((a, c) => a + c.profit, 0);
  assert.ok(Math.abs(result.finalState.realized - sum) < 1e-9);
});

test('일별 기록은 캔들 수와 같고 평가금은 잔금+평가+확정손익', () => {
  const config = makeConfig('TQQQ', 40, 10_000);
  const candles = series(ramp(50, 40, 20));
  const result = backtest(candles, config);

  assert.equal(result.days.length, candles.length);
  const last = result.days.at(-1)!;
  const { cash, qty, realized } = result.finalState;
  assert.equal(last.equity, cash + qty * candles.at(-1)!.close + realized);
});
