/**
 * 백테스트 실행 CLI.
 *
 *   node src/backtest/cli.ts <candles.json> [--ticker TQQQ] [--splits 40] [--seed 10000] [--simple]
 *
 * candles.json 은 { date, open, high, low, close } 배열. 날짜 오름차순.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Candle } from '../engine/types.ts';
import { makeConfig, type Ticker } from '../engine/v4.ts';
import { backtest } from './run.ts';

const { values, positionals } = parseArgs({
  options: {
    ticker: { type: 'string', default: 'TQQQ' },
    splits: { type: 'string', default: '40' },
    seed: { type: 'string', default: '10000' },
    simple: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const path = positionals[0];
if (!path) {
  console.error('usage: node src/backtest/cli.ts <candles.json> [--ticker TQQQ] [--splits 40] [--seed 10000] [--simple]');
  process.exit(1);
}

const candles: Candle[] = JSON.parse(readFileSync(path, 'utf8'));
const config = makeConfig(
  values.ticker as Ticker,
  Number(values.splits),
  Number(values.seed),
  !values.simple,
);

const result = backtest(candles, config);
const first = candles[0]?.date ?? '-';
const last = candles.at(-1)?.date ?? '-';

console.log(`${config.ticker} ${config.splits}분할 ${config.compound ? '복리' : '단리'} 시드 $${config.seed}`);
console.log(`기간 ${first} ~ ${last} (${candles.length}거래일)`);
console.log('');

for (const c of result.cycles) {
  console.log(
    `  ${c.startDate} ~ ${c.endDate}  ${String(c.days).padStart(4)}일  ` +
      `${c.profit >= 0 ? '+' : ''}${c.profit.toFixed(2)} (${c.returnPct.toFixed(2)}%)`,
  );
}

const reverseDays = result.days.filter((d) => d.reverseDay > 0).length;
console.log('');
console.log(`사이클 ${result.cycles.length}회, 리버스모드 ${reverseDays}일`);
console.log(`최종 평가금 $${result.finalEquity.toFixed(2)} (${result.totalReturnPct.toFixed(2)}%)`);
console.log(`최대 낙폭 ${result.maxDrawdownPct.toFixed(2)}%`);
if (result.finalState.qty > 0) {
  console.log(`미청산: ${result.finalState.qty}주, T=${result.finalState.t.toFixed(2)}`);
}
