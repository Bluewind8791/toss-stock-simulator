import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateFill, qtyForAmount } from './fill.ts';
import type { Candle } from './types.ts';

const candle: Candle = { date: '2026-01-02', open: 50, high: 55, low: 48, close: 52 };

test('LOC 매수는 종가가 지정가 이하일 때 종가로 체결', () => {
  assert.deepEqual(simulateFill({ side: 'buy', type: 'LOC', limit: 52, qty: 10 }, candle), {
    side: 'buy',
    price: 52,
    qty: 10,
  });
  assert.equal(simulateFill({ side: 'buy', type: 'LOC', limit: 51.99, qty: 10 }, candle), null);
});

test('LOC 매도는 종가가 지정가 이상일 때 종가로 체결', () => {
  assert.deepEqual(simulateFill({ side: 'sell', type: 'LOC', limit: 52, qty: 10 }, candle), {
    side: 'sell',
    price: 52,
    qty: 10,
  });
  assert.equal(simulateFill({ side: 'sell', type: 'LOC', limit: 52.01, qty: 10 }, candle), null);
});

test('LIMIT 매도는 고가가 목표가에 닿으면 목표가로 체결', () => {
  assert.deepEqual(simulateFill({ side: 'sell', type: 'LIMIT', limit: 54, qty: 10 }, candle), {
    side: 'sell',
    price: 54,
    qty: 10,
  });
  assert.equal(simulateFill({ side: 'sell', type: 'LIMIT', limit: 55.01, qty: 10 }, candle), null);
});

test('MOC 는 종가로 무조건 체결', () => {
  assert.deepEqual(simulateFill({ side: 'sell', type: 'MOC', qty: 3 }, candle), {
    side: 'sell',
    price: 52,
    qty: 3,
  });
});

test('수량 0 주문은 미체결', () => {
  assert.equal(simulateFill({ side: 'buy', type: 'MOC', qty: 0 }, candle), null);
});

test('지정가 없는 LOC/LIMIT 주문은 에러', () => {
  assert.throws(() => simulateFill({ side: 'buy', type: 'LOC', qty: 1 }, candle));
});

test('수량은 금액을 초과하지 않도록 내림', () => {
  assert.equal(qtyForAmount(100_000, 52.5), 1904);
  assert.equal(qtyForAmount(10, 52.5), 0);
});
