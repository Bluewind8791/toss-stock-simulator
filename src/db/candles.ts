/**
 * 일봉 로컬 저장소 (node:sqlite).
 * 백테스트 반복 실행 시 API 를 다시 부르지 않기 위해 받은 봉을 그대로 쌓아둔다.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Candle } from '../engine/types.ts';

export function openDb(path = process.env.DB_PATH ?? './data/sim.db'): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      symbol TEXT NOT NULL,
      date   TEXT NOT NULL,
      open   REAL NOT NULL,
      high   REAL NOT NULL,
      low    REAL NOT NULL,
      close  REAL NOT NULL,
      PRIMARY KEY (symbol, date)
    )
  `);
  return db;
}

/** 같은 (symbol, date) 는 덮어쓴다 — 같은 구간을 두 번 수집해도 결과가 같다. */
export function saveCandles(db: DatabaseSync, symbol: string, candles: Candle[]): number {
  const stmt = db.prepare(`
    INSERT INTO candles (symbol, date, open, high, low, close)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, date) DO UPDATE SET
      open = excluded.open, high = excluded.high,
      low = excluded.low, close = excluded.close
  `);
  db.exec('BEGIN');
  try {
    for (const c of candles) stmt.run(symbol, c.date, c.open, c.high, c.low, c.close);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return candles.length;
}

/** 날짜 오름차순. from/to 는 포함. */
export function loadCandles(
  db: DatabaseSync,
  symbol: string,
  from = '0000-00-00',
  to = '9999-99-99',
): Candle[] {
  return db
    .prepare(
      `SELECT date, open, high, low, close FROM candles
       WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date`,
    )
    .all(symbol, from, to) as unknown as Candle[];
}

/** 저장된 마지막 거래일. 없으면 null. 수집 시 갭만 이어받는 데 쓴다. */
export function lastCandleDate(db: DatabaseSync, symbol: string): string | null {
  const row = db
    .prepare('SELECT MAX(date) AS date FROM candles WHERE symbol = ?')
    .get(symbol) as { date: string | null } | undefined;
  return row?.date ?? null;
}
