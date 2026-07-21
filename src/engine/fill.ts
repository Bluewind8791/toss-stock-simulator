import type { Candle, Fill, Order } from './types.ts';

/**
 * 주문 하나를 일봉 하나에 대해 체결 판정한다.
 * 미체결이면 null. 부분체결은 모사하지 않는다(전량 체결 또는 미체결).
 */
export function simulateFill(order: Order, candle: Candle): Fill | null {
  const { side, type, limit, qty } = order;
  if (qty <= 0) return null;

  if (type === 'MOC') {
    return { side, price: candle.close, qty };
  }

  if (limit === undefined) {
    throw new Error(`${type} order requires a limit price`);
  }

  if (type === 'LOC') {
    const filled = side === 'buy' ? candle.close <= limit : candle.close >= limit;
    return filled ? { side, price: candle.close, qty } : null;
  }

  // LIMIT: 장중 도달 여부로 판정하고 지정가로 체결한다.
  const filled = side === 'buy' ? candle.low <= limit : candle.high >= limit;
  return filled ? { side, price: limit, qty } : null;
}

/** 주문 지정가 기준 수량 산정. 금액을 초과하지 않도록 내림한다. */
export function qtyForAmount(amount: number, price: number): number {
  if (price <= 0) return 0;
  return Math.floor(amount / price);
}
