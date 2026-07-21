/**
 * 백테스트 러너 — 캔들 배열을 하루씩 엔진에 흘려 사이클·수익률을 집계한다.
 * 페이퍼 트레이딩도 같은 planOrders/step 을 하루 1회 호출하므로 여기엔 "실시간" 분기가 없다.
 */
import type { Candle } from '../engine/types.ts';
import { initState, planOrders, step, type Config, type State } from '../engine/v4.ts';

export type CycleRecord = {
  startDate: string;
  endDate: string;
  /** 사이클에 든 거래일 수 */
  days: number;
  profit: number;
  returnPct: number;
};

export type DayRecord = {
  date: string;
  /** 평가금 = 잔금 + 보유수량 × 종가 + 확정손익 */
  equity: number;
  t: number;
  qty: number;
  reverseDay: number;
};

export type BacktestResult = {
  days: DayRecord[];
  cycles: CycleRecord[];
  /** 마지막 날 평가금 */
  finalEquity: number;
  totalReturnPct: number;
  /** 평가금 기준 최대 낙폭 % */
  maxDrawdownPct: number;
  /** 미청산 상태로 끝났으면 마지막 상태 */
  finalState: State;
};

/** 평가금 = 잔금 + 보유수량 × 종가 + 확정손익 */
function equityOf(state: State, close: number): number {
  return state.cash + state.qty * close + state.realized;
}

export function backtest(candles: Candle[], config: Config): BacktestResult {
  let state = initState(config);
  const closes: number[] = [];
  const days: DayRecord[] = [];
  const cycles: CycleRecord[] = [];

  let cycleStartDate = candles[0]?.date ?? '';
  let cycleStartEquity = config.seed;
  let cycleStartIndex = 0;
  let peak = config.seed;
  let maxDrawdownPct = 0;

  for (const [i, candle] of candles.entries()) {
    const orders = planOrders(state, config, closes);
    const result = step(state, config, candle, orders);
    state = result.state;
    closes.push(candle.close);

    if (result.cycleClosed) {
      const profit = state.cash + state.realized - cycleStartEquity;
      cycles.push({
        startDate: cycleStartDate,
        endDate: candle.date,
        days: i - cycleStartIndex + 1,
        profit,
        returnPct: cycleStartEquity > 0 ? (profit / cycleStartEquity) * 100 : 0,
      });
      cycleStartDate = candles[i + 1]?.date ?? candle.date;
      cycleStartEquity = state.cash + state.realized;
      cycleStartIndex = i + 1;
    }

    const equity = equityOf(state, candle.close);
    days.push({ date: candle.date, equity, t: state.t, qty: state.qty, reverseDay: state.reverseDay });

    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
    }
  }

  const finalEquity = days.at(-1)?.equity ?? config.seed;
  return {
    days,
    cycles,
    finalEquity,
    totalReturnPct: ((finalEquity - config.seed) / config.seed) * 100,
    maxDrawdownPct,
    finalState: state,
  };
}
