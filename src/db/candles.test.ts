import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../engine/types.ts';
import { lastCandleDate, loadCandles, openDb, saveCandles } from './candles.ts';

const c = (date: string, close: number): Candle => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
});

/** 파일을 만들지 않도록 인메모리 DB 를 쓴다. */
function memDb() {
  return openDb(':memory:');
}

test('저장한 일봉을 날짜 오름차순으로 읽는다', () => {
  const db = memDb();
  saveCandles(db, 'TQQQ', [c('2026-01-03', 52), c('2026-01-02', 50)]);
  assert.deepEqual(
    loadCandles(db, 'TQQQ').map((x) => x.date),
    ['2026-01-02', '2026-01-03'],
  );
  db.close();
});

test('같은 날짜를 다시 저장해도 행이 늘지 않고 값만 갱신된다', () => {
  const db = memDb();
  saveCandles(db, 'TQQQ', [c('2026-01-02', 50)]);
  saveCandles(db, 'TQQQ', [c('2026-01-02', 51)]);
  const rows = loadCandles(db, 'TQQQ');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.close, 51);
  db.close();
});

test('심볼별로 분리되고 기간 필터가 적용된다', () => {
  const db = memDb();
  saveCandles(db, 'TQQQ', [c('2026-01-02', 50), c('2026-01-05', 53)]);
  saveCandles(db, 'SOXL', [c('2026-01-02', 20)]);
  assert.equal(loadCandles(db, 'SOXL').length, 1);
  assert.equal(loadCandles(db, 'TQQQ', '2026-01-03').length, 1);
  assert.equal(loadCandles(db, 'TQQQ', '2026-01-01', '2026-01-03').length, 1);
  db.close();
});

test('마지막 거래일은 없으면 null', () => {
  const db = memDb();
  assert.equal(lastCandleDate(db, 'TQQQ'), null);
  saveCandles(db, 'TQQQ', [c('2026-01-02', 50), c('2026-01-05', 53)]);
  assert.equal(lastCandleDate(db, 'TQQQ'), '2026-01-05');
  db.close();
});
