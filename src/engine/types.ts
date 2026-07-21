/** 일봉 한 개. 가격은 해당 종목 통화 기준. */
export type Candle = {
  /** YYYY-MM-DD (거래소 현지 기준) */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type OrderSide = 'buy' | 'sell';

/**
 * LOC  - 종가 동시호가. 매수는 종가 <= limit, 매도는 종가 >= limit 일 때 종가로 체결.
 * LIMIT - 장중 지정가. 매수는 저가 <= limit, 매도는 고가 >= limit 일 때 limit 으로 체결.
 * MOC  - 종가 시장가. 무조건 종가로 체결.
 */
export type OrderType = 'LOC' | 'LIMIT' | 'MOC';

export type Order = {
  side: OrderSide;
  type: OrderType;
  /** MOC 는 가격 없음 */
  limit?: number;
  qty: number;
};

export type Fill = {
  side: OrderSide;
  price: number;
  qty: number;
};
