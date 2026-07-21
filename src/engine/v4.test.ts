import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avgPrice,
  initState,
  makeConfig,
  needsReverseMode,
  planOrders,
  starPct,
  step,
  unitAmount,
  type State,
} from './v4.ts';
import type { Candle } from './types.ts';

const candle = (close: number, high = close, low = close): Candle => ({
  date: '2026-01-02',
  open: close,
  high,
  low,
  close,
});

test('별% 는 출처의 종목·분할별 공식과 일치한다', () => {
  // 40분할 TQQQ: 15 - 0.75T
  assert.equal(starPct(10, makeConfig('TQQQ', 40, 40_000)), 15 - 0.75 * 10);
  // 20분할 TQQQ: 15 - 1.5T
  assert.equal(starPct(5, makeConfig('TQQQ', 20, 40_000)), 15 - 1.5 * 5);
  // 40분할 SOXL: 20 - T
  assert.equal(starPct(10, makeConfig('SOXL', 40, 40_000)), 20 - 10);
  // 20분할 SOXL: 20 - 2T
  assert.equal(starPct(5, makeConfig('SOXL', 20, 40_000)), 20 - 2 * 5);
});

test('별% 는 T = 분할수/2 에서 0 이고 후반전에는 음수', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  assert.equal(starPct(20, config), 0);
  assert.ok(starPct(21, config) < 0);
});

test('1회매수금 = 잔금 / (분할수 − T)', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  assert.equal(unitAmount(initState(config), config), 1000);
  assert.equal(unitAmount({ ...initState(config), t: 20, cash: 20_000 }, config), 1000);
});

test('첫날은 전일 종가 위 큰수 LOC 매수 하나만 낸다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const orders = planOrders(initState(config), config, 50);
  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0], { side: 'buy', type: 'LOC', limit: 57.5, qty: 17 });
});

test('전반전은 매수 주문을 별지점 아래와 평단 둘로 쪼갠다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 10, cash: 30_000, qty: 200, cost: 10_000, realized: 0 };
  const buys = planOrders(state, config, 50).filter((o) => o.side === 'buy');
  assert.equal(buys.length, 2);
  // 평단 50, T=10 → 별% 7.5 → 별지점 53.75 → 매수가 53.74
  assert.equal(buys[0]?.limit, 53.74);
  assert.equal(buys[1]?.limit, 50);
});

test('후반전은 매수 주문 하나이고 가격이 평단보다 낮다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 30, cash: 10_000, qty: 200, cost: 10_000, realized: 0 };
  const buys = planOrders(state, config, 50).filter((o) => o.side === 'buy');
  assert.equal(buys.length, 1);
  assert.ok((buys[0]?.limit ?? 0) < avgPrice(state));
});

test('매도 주문은 1/4 별지점 LOC + 3/4 평단 +base% 지정가', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 10, cash: 30_000, qty: 200, cost: 10_000, realized: 0 };
  const sells = planOrders(state, config, 50).filter((o) => o.side === 'sell');
  assert.deepEqual(sells, [
    { side: 'sell', type: 'LOC', limit: 53.75, qty: 50 },
    { side: 'sell', type: 'LIMIT', limit: 57.5, qty: 150 },
  ]);
});

test('쿼터매도만 체결되면 T 가 0.75 배가 되고 평단은 유지된다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 10, cash: 30_000, qty: 200, cost: 10_000, realized: 0 };
  const sells = planOrders(state, config, 50).filter((o) => o.side === 'sell');
  // 종가 54 → LOC 매도(53.75) 체결, 지정가 매도(57.5) 미체결
  const result = step(state, config, candle(54, 55), sells);
  assert.equal(result.state.qty, 150);
  assert.equal(result.state.t, 7.5);
  assert.equal(avgPrice(result.state), 50);
  assert.equal(result.cycleClosed, false);
});

test('지정가 매도만 체결되면 T 가 0.25 배가 되고 사이클은 이어진다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 10, cash: 30_000, qty: 200, cost: 10_000, realized: 0 };
  const sells = planOrders(state, config, 50).filter((o) => o.side === 'sell');
  // 고가 58 → 지정가 57.5 체결, 종가 53 → LOC 매도(53.75) 미체결
  const result = step(state, config, candle(53, 58), sells);
  assert.equal(result.state.qty, 50);
  assert.equal(result.state.t, 2.5);
  assert.equal(result.cycleClosed, false);
});

test('보유수량이 0 이 되면 사이클 종료 후 T 와 원가가 리셋된다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 10, cash: 30_000, qty: 200, cost: 10_000, realized: 0 };
  const sells = planOrders(state, config, 50).filter((o) => o.side === 'sell');
  // 고가 58 → 지정가 체결, 종가 56 → LOC 매도도 체결 → 전량 소진
  const result = step(state, config, candle(56, 58), sells);
  assert.equal(result.state.qty, 0);
  assert.equal(result.cycleClosed, true);
  assert.equal(result.state.t, 0);
  assert.equal(result.state.cost, 0);
  assert.ok(result.state.cash > 40_000);
});

test('단리면 사이클 종료 시 시드로 되돌리고 수익을 realized 에 뺀다', () => {
  const config = makeConfig('TQQQ', 40, 40_000, false);
  const state: State = { t: 10, cash: 30_000, qty: 200, cost: 10_000, realized: 0 };
  const sells = planOrders(state, config, 50).filter((o) => o.side === 'sell');
  const result = step(state, config, candle(56, 58), sells);
  assert.equal(result.state.cash, 40_000);
  assert.ok(result.state.realized > 0);
});

test('1회분 매수가 체결되면 T 가 약 1 늘어난다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const orders = planOrders(initState(config), config, 50);
  // 종가 50 → 큰수 LOC(57.5) 체결. 17주 × $50 = $850, 1회매수금 $1000
  const result = step(initState(config), config, candle(50), orders);
  assert.equal(result.state.qty, 17);
  assert.equal(result.state.cash, 40_000 - 850);
  assert.equal(result.state.t, 0.85);
});

test('T 가 분할수−1 을 넘으면 리버스모드 대상이고 매수 주문을 내지 않는다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state: State = { t: 39.5, cash: 100, qty: 800, cost: 40_000, realized: 0 };
  assert.equal(needsReverseMode(state, config), true);
  assert.equal(planOrders(state, config, 50).filter((o) => o.side === 'buy').length, 0);
});
