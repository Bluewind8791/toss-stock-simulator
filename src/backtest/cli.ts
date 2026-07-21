/**
 * 백테스트 실행 CLI.
 *
 *   node src/backtest/cli.ts <SYMBOL|candles.json> [--splits 40] [--seed 10000] [--simple]
 *                            [--from 2020-01-01] [--to 2024-12-31]
 *
 * 인자가 .json 이면 { date, open, high, low, close } 배열 파일, 아니면 DB 에 수집된 심볼.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Candle } from '../engine/types.ts';
import { loadCandles, openDb } from '../db/candles.ts';
import { makeConfig, type Ticker } from '../engine/v4.ts';
import { backtest } from './run.ts';

const { values, positionals } = parseArgs({
  options: {
    ticker: { type: 'string' },
    splits: { type: 'string', default: '40' },
    seed: { type: 'string', default: '10000' },
    simple: { type: 'boolean', default: false },
    from: { type: 'string' },
    to: { type: 'string' },
  },
  allowPositionals: true,
});

const source = positionals[0];
if (!source) {
  console.error('usage: node src/backtest/cli.ts <SYMBOL|candles.json> [--splits 40] [--seed 10000] [--simple] [--from] [--to]');
  process.exit(1);
}

let candles: Candle[];
if (source.endsWith('.json')) {
  candles = JSON.parse(readFileSync(source, 'utf8'));
} else {
  const db = openDb();
  candles = loadCandles(db, source, values.from, values.to);
  db.close();
  if (candles.length === 0) {
    console.error(`${source} 일봉이 DB 에 없습니다. 먼저 node src/scripts/collect.ts ${source}`);
    process.exit(1);
  }
}

const ticker = values.ticker ?? (source.endsWith('.json') ? 'TQQQ' : source);
if (ticker !== 'TQQQ' && ticker !== 'SOXL') {
  console.error(`별% 기준값이 정의된 종목만 됩니다 (TQQQ | SOXL). --ticker 로 지정하세요.`);
  process.exit(1);
}

const config = makeConfig(
  ticker as Ticker,
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
