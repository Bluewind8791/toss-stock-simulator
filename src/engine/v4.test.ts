import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avgPrice,
  initState,
  isReverse,
  makeConfig,
  needsReverseMode,
  planOrders,
  reverseStarPrice,
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

/** 평단 50, T=10, 200주 보유 — 전반전 표준 상태 */
const held = (over: Partial<State> = {}): State => ({
  t: 10,
  cash: 30_000,
  qty: 200,
  cost: 10_000,
  realized: 0,
  reverseDay: 0,
  ...over,
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
  const orders = planOrders(initState(config), config, [50]);
  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0], { side: 'buy', type: 'LOC', limit: 57.5, qty: 17 });
});

test('전반전은 매수 주문을 별지점 아래와 평단 둘로 쪼갠다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const buys = planOrders(held(), config, [50]).filter((o) => o.side === 'buy');
  assert.equal(buys.length, 2);
  // 평단 50, T=10 → 별% 7.5 → 별지점 53.75 → 매수가 53.74
  assert.equal(buys[0]?.limit, 53.74);
  assert.equal(buys[1]?.limit, 50);
});

test('후반전은 매수 주문 하나이고 가격이 평단보다 낮다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state = held({ t: 30, cash: 10_000 });
  const buys = planOrders(state, config, [50]).filter((o) => o.side === 'buy');
  assert.equal(buys.length, 1);
  assert.ok((buys[0]?.limit ?? 0) < avgPrice(state));
});

test('매도 주문은 1/4 별지점 LOC + 3/4 평단 +base% 지정가', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const sells = planOrders(held(), config, [50]).filter((o) => o.side === 'sell');
  assert.deepEqual(sells, [
    { side: 'sell', type: 'LOC', limit: 53.75, qty: 50 },
    { side: 'sell', type: 'LIMIT', limit: 57.5, qty: 150 },
  ]);
});

test('쿼터매도만 체결되면 T 가 0.75 배가 되고 평단은 유지된다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const sells = planOrders(held(), config, [50]).filter((o) => o.side === 'sell');
  // 종가 54 → LOC 매도(53.75) 체결, 지정가 매도(57.5) 미체결
  const result = step(held(), config, candle(54, 55), sells);
  assert.equal(result.state.qty, 150);
  assert.equal(result.state.t, 7.5);
  assert.equal(avgPrice(result.state), 50);
  assert.equal(result.cycleClosed, false);
});

test('지정가 매도만 체결되면 T 가 0.25 배가 되고 사이클은 이어진다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const sells = planOrders(held(), config, [50]).filter((o) => o.side === 'sell');
  // 고가 58 → 지정가 57.5 체결, 종가 53 → LOC 매도(53.75) 미체결
  const result = step(held(), config, candle(53, 58), sells);
  assert.equal(result.state.qty, 50);
  assert.equal(result.state.t, 2.5);
  assert.equal(result.cycleClosed, false);
});

test('보유수량이 0 이 되면 사이클 종료 후 T 와 원가가 리셋된다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const sells = planOrders(held(), config, [50]).filter((o) => o.side === 'sell');
  // 고가 58 → 지정가 체결, 종가 56 → LOC 매도도 체결 → 전량 소진
  const result = step(held(), config, candle(56, 58), sells);
  assert.equal(result.state.qty, 0);
  assert.equal(result.cycleClosed, true);
  assert.equal(result.state.t, 0);
  assert.equal(result.state.cost, 0);
  assert.ok(result.state.cash > 40_000);
});

test('단리면 사이클 종료 시 시드로 되돌리고 수익을 realized 에 뺀다', () => {
  const config = makeConfig('TQQQ', 40, 40_000, false);
  const sells = planOrders(held(), config, [50]).filter((o) => o.side === 'sell');
  const result = step(held(), config, candle(56, 58), sells);
  assert.equal(result.state.cash, 40_000);
  assert.ok(result.state.realized > 0);
});

test('1회분 매수가 체결되면 T 가 약 1 늘어난다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const orders = planOrders(initState(config), config, [50]);
  // 종가 50 → 큰수 LOC(57.5) 체결. 17주 × $50 = $850, 1회매수금 $1000
  const result = step(initState(config), config, candle(50), orders);
  assert.equal(result.state.qty, 17);
  assert.equal(result.state.cash, 40_000 - 850);
  assert.equal(result.state.t, 0.85);
});

test('T 가 분할수−1 을 넘으면 리버스모드 대상이고 매수 주문을 내지 않는다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state = held({ t: 39.5, cash: 100, qty: 800, cost: 40_000 });
  assert.equal(needsReverseMode(state, config), true);
  assert.equal(planOrders(state, config, [50]).filter((o) => o.side === 'buy').length, 0);
});

// ── 리버스모드 ──────────────────────────────────────────────

test('원금이 소진된 날 다음날부터 리버스모드로 넘어간다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  // T 39.5, 평단 50 → 별% 는 음수, 매도 주문만 나오고 미체결로 하루가 지난다
  const state = held({ t: 39.5, cash: 100, qty: 800, cost: 40_000 });
  const result = step(state, config, candle(30, 31), planOrders(state, config, [50]));
  assert.equal(isReverse(result.state), true);
  assert.equal(result.state.reverseDay, 1);
});

test('리버스 별지점은 직전 5거래일 종가 평균', () => {
  assert.equal(reverseStarPrice([10, 20, 30, 40, 50]), 30);
  // 5개를 넘으면 뒤 5개만 쓴다
  assert.equal(reverseStarPrice([1000, 10, 20, 30, 40, 50]), 30);
});

test('리버스 첫날은 MOC 매도만 하고 매수하지 않는다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state = held({ t: 39.5, cash: 1000, qty: 800, cost: 40_000, reverseDay: 1 });
  // 40분할 → 800 × 2/40 = 40주
  assert.deepEqual(planOrders(state, config, [30, 30, 30, 30, 30]), [
    { side: 'sell', type: 'MOC', qty: 40 },
  ]);
});

test('리버스 둘째날부터 별지점 위 매도 + 별지점 아래 잔금 1/4 매수', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state = held({ t: 39.5, cash: 1000, qty: 760, cost: 38_000, reverseDay: 2 });
  const orders = planOrders(state, config, [28, 29, 30, 31, 32]);
  // 별지점 = 30
  assert.deepEqual(orders, [
    { side: 'sell', type: 'LOC', limit: 30, qty: 38 },
    // 잔금 1000 / 4 = 250, 매수가 29.99 → 8주
    { side: 'buy', type: 'LOC', limit: 29.99, qty: 8 },
  ]);
});

test('리버스 매도 체결 시 T 계수는 1 − 2/분할수 와 같다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state = held({ t: 40, cash: 0, qty: 800, cost: 40_000, reverseDay: 1 });
  const result = step(state, config, candle(30), planOrders(state, config, [30]));
  assert.equal(result.state.qty, 760);
  assert.equal(result.state.t, 40 * 0.95);
});

test('리버스 매수 체결 시 T = T + (분할수 − T) × 0.25', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  // 매도는 미체결(종가 < 별지점)이고 매수만 체결되는 상황
  const state = held({ t: 36, cash: 1000, qty: 800, cost: 40_000, reverseDay: 2 });
  const orders = planOrders(state, config, [30, 30, 30, 30, 30]);
  const result = step(state, config, candle(29), orders);
  assert.equal(result.state.t, 36 + (40 - 36) * 0.25);
});

test('종가가 평단 대비 −base% 위로 올라오면 다음날 일반모드로 복귀하고 T 를 승계한다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  // 평단 50 → 복귀 기준선 42.5. 별지점 50 이라 매도는 미체결이고 잔금 0 이라 매수도 없다.
  const state = held({ t: 38, cash: 0, qty: 800, cost: 40_000, reverseDay: 3 });
  const history = [50, 50, 50, 50, 50];
  const below = step(state, config, candle(42), planOrders(state, config, history));
  assert.equal(below.state.reverseDay, 4);

  const above = step(state, config, candle(43), planOrders(state, config, history));
  assert.equal(isReverse(above.state), false);
  assert.equal(above.state.t, 38); // 매도 미체결이라 T 그대로 승계
});

test('리버스 중 보유수량이 0 이 되면 사이클 종료이고 일반모드로 돌아간다', () => {
  const config = makeConfig('TQQQ', 40, 40_000);
  const state = held({ t: 40, cash: 0, qty: 20, cost: 1000, reverseDay: 2 });
  // 20 × 2/40 = 1 주씩 팔리므로 전량 매도 주문을 직접 넣어 종료 상황을 만든다
  const result = step(state, config, candle(30), [{ side: 'sell', type: 'MOC', qty: 20 }]);
  assert.equal(result.cycleClosed, true);
  assert.equal(result.state.reverseDay, 0);
  assert.equal(result.state.t, 0);
});
