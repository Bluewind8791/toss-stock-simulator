/**
 * 일봉 수집 스크립트.
 *
 *   node src/scripts/collect.ts TQQQ SOXL [--since 2020-01-01] [--full]
 *
 * 기본은 증분 — 저장된 마지막 거래일부터 이어 받는다.
 * --full 은 maxPages 만큼 과거로 끝까지 훑는다.
 */
import { parseArgs } from 'node:util';
import { createClient } from '../api/client.ts';
import { fetchDailyCandles } from '../api/candles.ts';
import { lastCandleDate, openDb, saveCandles } from '../db/candles.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // .env 가 없으면 환경변수를 그대로 쓴다
}

const { values, positionals } = parseArgs({
  options: {
    since: { type: 'string' },
    full: { type: 'boolean', default: false },
    maxPages: { type: 'string', default: '20' },
  },
  allowPositionals: true,
});

if (positionals.length === 0) {
  console.error('usage: node src/scripts/collect.ts <SYMBOL...> [--since 2020-01-01] [--full]');
  process.exit(1);
}

const client = createClient();
const db = openDb();

for (const symbol of positionals) {
  const since = values.full ? values.since : (values.since ?? lastCandleDate(db, symbol) ?? undefined);
  const candles = await fetchDailyCandles(client, symbol, {
    since,
    maxPages: Number(values.maxPages),
  });
  saveCandles(db, symbol, candles);
  const range = candles.length > 0 ? `${candles[0]!.date} ~ ${candles.at(-1)!.date}` : '없음';
  console.log(`${symbol}: ${candles.length}봉 저장 (${range})`);
}

db.close();
