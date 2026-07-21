/**
 * 무한매수법 V4.0 · 일반모드.
 * 규칙 출처: https://quantstack.app/infinite/v4-0-normal/
 * 리버스모드(T > 분할수-1)는 아직 미구현 — needsReverseMode() 로 판정만 한다.
 */
import type { Candle, Fill, Order } from './types.ts';
import { qtyForAmount, simulateFill } from './fill.ts';

export type Ticker = 'TQQQ' | 'SOXL';

export type Config = {
  ticker: Ticker;
  /** 20 | 30 | 40. 낮을수록 공격적. */
  splits: number;
  /** 사이클 시드. 단리일 때 사이클 시작마다 이 값으로 되돌린다. */
  seed: number;
  /** 사이클 종료 후 수익금을 다음 사이클 시드에 반영할지 */
  compound: boolean;
  /** 호가 단위. 매수가는 별지점에서 1틱 아래. */
  tickSize: number;
};

/** 익절 기준 % 이자 별% 공식의 기준값. */
const BASE_PCT: Record<Ticker, number> = { TQQQ: 15, SOXL: 20 };

export function makeConfig(
  ticker: Ticker,
  splits: number,
  seed: number,
  compound = true,
): Config {
  return { ticker, splits, seed, compound, tickSize: 0.01 };
}

export type State = {
  /** 회차. 매수로 늘고, 부분 매도로 남은 수량 비율만큼 줄어든다. */
  t: number;
  /** 잔금 */
  cash: number;
  qty: number;
  /** 누적 매수 원가. 평단 = cost / qty */
  cost: number;
  /** 종료된 사이클들의 누적 손익 (단리일 때만 쌓인다) */
  realized: number;
};

export function initState(config: Config): State {
  return { t: 0, cash: config.seed, qty: 0, cost: 0, realized: 0 };
}

export function avgPrice(state: State): number {
  return state.qty > 0 ? state.cost / state.qty : 0;
}

/** 별% = base × (1 − 2T/분할수). T = 분할수/2 에서 0 이 되고 후반전부터 음수. */
export function starPct(t: number, config: Config): number {
  return BASE_PCT[config.ticker] * (1 - (2 * t) / config.splits);
}

/** 별지점 = 평단 × (1 + 별%) */
export function starPrice(state: State, config: Config): number {
  return round2(avgPrice(state) * (1 + starPct(state.t, config) / 100));
}

/** 1회매수금 = 잔금 / (분할수 − T) */
export function unitAmount(state: State, config: Config): number {
  const left = config.splits - state.t;
  return left > 0 ? state.cash / left : 0;
}

/** 원금 소진 — 리버스모드로 전환해야 하는 상태 */
export function needsReverseMode(state: State, config: Config): boolean {
  return state.t > config.splits - 1;
}

/**
 * 그날 장 시작 전에 걸어둘 주문 목록.
 * 가격은 전일까지의 상태로 산출한다 — 당일 체결 결과는 반영하지 않는다.
 */
export function planOrders(state: State, config: Config, prevClose: number): Order[] {
  const orders: Order[] = [];
  const half = config.splits / 2;

  if (state.qty > 0) {
    // 쿼터매도: 보유 1/4 을 별지점 LOC 매도
    const quarter = Math.floor(state.qty / 4);
    if (quarter > 0) {
      orders.push({ side: 'sell', type: 'LOC', limit: starPrice(state, config), qty: quarter });
    }
    // 나머지: 평단 +base% 지정가 매도
    const rest = state.qty - quarter;
    if (rest > 0) {
      const target = round2(avgPrice(state) * (1 + BASE_PCT[config.ticker] / 100));
      orders.push({ side: 'sell', type: 'LIMIT', limit: target, qty: rest });
    }
  }

  if (needsReverseMode(state, config)) return orders;

  const unit = unitAmount(state, config);
  if (unit <= 0) return orders;

  if (state.qty === 0) {
    // 첫 매수: 평단이 없으므로 전일 종가 기준 큰수 LOC 매수
    const limit = round2(prevClose * (1 + BASE_PCT[config.ticker] / 100));
    pushBuy(orders, unit, limit);
  } else if (state.t < half) {
    // 전반전: 절반은 별지점 아래(큰수), 절반은 평단
    pushBuy(orders, unit / 2, round2(starPrice(state, config) - config.tickSize));
    pushBuy(orders, unit / 2, round2(avgPrice(state)));
  } else {
    // 후반전: 전액 별지점 아래. 별% 가 음수라 평단보다 낮다.
    pushBuy(orders, unit, round2(starPrice(state, config) - config.tickSize));
  }

  return orders;
}

function pushBuy(orders: Order[], amount: number, limit: number): void {
  const qty = qtyForAmount(amount, limit);
  if (qty > 0) orders.push({ side: 'buy', type: 'LOC', limit, qty });
}

export type DayResult = {
  state: State;
  fills: Fill[];
  /** 이 날 보유수량이 0 이 되어 사이클이 끝났는지 */
  cycleClosed: boolean;
};

/**
 * 주문 목록을 하루치 캔들에 적용한다.
 * 매도를 먼저 반영한 뒤 매수를 반영한다 — 지정가 매도 후 급락으로 LOC 매수가
 * 체결되는 경우가 규칙상 허용되기 때문이다.
 */
export function step(
  state: State,
  config: Config,
  candle: Candle,
  orders: Order[],
): DayResult {
  const fills: Fill[] = [];
  let { t, cash, qty, cost, realized } = state;

  const qtyBefore = qty;
  for (const order of orders.filter((o) => o.side === 'sell')) {
    const fill = simulateFill(order, candle);
    if (!fill) continue;
    fills.push(fill);
    // 매도는 평단을 바꾸지 않는다. 원가를 수량 비율만큼 덜어낸다.
    cost -= avgPrice({ t, cash, qty, cost, realized }) * fill.qty;
    qty -= fill.qty;
    cash += fill.price * fill.qty;
  }
  if (qty !== qtyBefore) {
    // 부분 매도 시 남은 수량 비율만큼 T 를 줄인다.
    // 1/4 매도 → ×0.75, 3/4 매도 → ×0.25 로 규칙과 일치한다.
    t = qtyBefore > 0 ? t * (qty / qtyBefore) : 0;
  }

  const unit = unitAmount({ t: state.t, cash, qty, cost, realized }, config);
  for (const order of orders.filter((o) => o.side === 'buy')) {
    const fill = simulateFill(order, candle);
    if (!fill) continue;
    const amount = fill.price * fill.qty;
    if (amount > cash) continue; // 잔금 부족분은 체결되지 않은 것으로 본다
    fills.push(fill);
    qty += fill.qty;
    cost += amount;
    cash -= amount;
    // T = 누적매수액 / 1회매수액. 1회분 체결이면 +1, 절반이면 +0.5 가 된다.
    if (unit > 0) t += amount / unit;
  }

  const cycleClosed = qtyBefore > 0 && qty === 0;
  if (cycleClosed) {
    t = 0;
    cost = 0;
    if (!config.compound) {
      realized += cash - config.seed;
      cash = config.seed;
    }
  }

  return { state: { t, cash, qty, cost, realized }, fills, cycleClosed };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
