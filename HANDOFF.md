# HANDOFF

작성 2026-07-21 · 최신 커밋 `0034a3d` · 테스트 41/41 통과

프로젝트 규칙은 [CLAUDE.md](./CLAUDE.md), 전략 수식·API 요약은 [README.md](./README.md) 참조.
이 문서는 **다음 작업자가 알아야 할 진행 상황과 함정**만 적는다.

## Goal

토스증권 Open API 기반 **라오어 무한매수법 시뮬레이터**.

1. 백테스트 — 과거 일봉으로 전략 검증
2. 페이퍼 트레이딩 — 앱을 한 달 내내 띄워두고 매일 하루치 처리 (사용자의 핵심 요구)

**실주문은 범위 밖.** 주문 생성/수정/취소 API 는 호출하지 않는다.
구현 대상 버전은 **v4.0** (일반모드 + 리버스모드 완료).

## Current Progress

| 영역 | 상태 | 위치 |
|---|---|---|
| 스캐폴딩 (Node 24, 의존성 0) | 완료 | `package.json`, `tsconfig.json` |
| 체결 모사 (LOC/LIMIT/MOC) | 완료 | `src/engine/fill.ts` |
| v4.0 일반모드 엔진 | 완료 | `src/engine/v4.ts` |
| v4.0 리버스모드 | 완료 | 같은 파일 (`reverseDay` 로 모드 표현) |
| 백테스트 러너 + CLI | 완료 | `src/backtest/` |
| 토스 API 클라이언트 | 완료 (**실키 미검증**) | `src/api/client.ts` |
| 일봉 수집 + SQLite 캐시 | 완료 (**실키 미검증**) | `src/api/candles.ts`, `src/db/candles.ts`, `src/scripts/collect.ts` |
| 시뮬 상태 영속화 | **미착수** | — |
| 일일 스케줄러 (페이퍼) | **미착수** | — |
| 다른 버전 (v2.1/v2.2/v3.0) | 미착수 | — |
| 웹 UI | 미착수 | — |

검증: `npm run typecheck && npm test`

### 확정한 토스 API 스펙

문서 사이트(`developers.tossinvest.com/docs`)는 JS 렌더링이라 fetch 로 못 읽는다.
**`https://openapi.tossinvest.com/openapi-docs/` 아래 마크다운을 읽을 것.**

- Base URL `https://openapi.tossinvest.com`
- `POST /oauth2/token` — form-urlencoded, `grant_type=client_credentials`.
  응답 `access_token` / `token_type` / `expires_in`. **리프레시 토큰 없음.**
  클라이언트당 유효 토큰 1개 — 재발급하면 이전 토큰이 죽는다.
- `GET /api/v1/candles` — `symbol`, `interval=1d`, `count` ≤ 200, `before` 커서(과거 방향),
  응답 `{ result: { candles: [{timestamp, openPrice, highPrice, lowPrice, closePrice, volume}], nextBefore } }`
- 모든 응답이 `{ result: ... }` 봉투. 클라이언트가 벗겨서 돌려준다.
- 레이트: `MARKET_DATA_CHART` 5/sec, `AUTH` 5/sec. 429 는 `Retry-After` 헤더.
- 개장일 판정용 `GET /api/v1/market-calendar/US` 존재 (아직 미사용).

## What Worked

- **Node 24 내장만으로 의존성 0 유지** — `.ts` 직접 실행(빌드 스텝 없음), `node:sqlite`,
  `node:test`, `fetch`, `node:util` `parseArgs`, `process.loadEnvFile`.
  Windows 에서 `better-sqlite3` 네이티브 빌드를 피한 게 컸다.
- **별% 통합 공식 유도** — `별% = base × (1 − 2T/분할수)` (base: TQQQ 15, SOXL 20).
  출처의 4가지 형태(`15−0.75T`, `15−1.5T`, `20−T`, `20−2T`)를 전부 재현하고
  `T = 분할수/2` 에서 정확히 0 이 된다. 30분할도 공짜로 따라온다. 테스트로 못 박아둠.
- **T 감소 규칙 통합** — 부분 매도 시 T 에 *남은 수량 비율*을 곱한다.
  쿼터매도 ×0.75, 지정가매도 ×0.25, 리버스 매도 계수 `1 − 2/분할수` 가 전부 이 한 규칙에서 나온다.
  덕분에 `step()` 의 매도 경로가 두 모드 공용.
- **v2.2 대신 v4.0 을 먼저 구현** — v2.2 는 부분 매도 후 T 처리가 어디에도 공개돼 있지 않다.
  먼저 만들었으면 조용히 틀린 숫자가 나왔을 것.
- **엔진을 순수 함수로 분리** — `planOrders(state, config, recentCloses)` → `step(state, config, candle, orders)`.
  백테스트는 루프로, 페이퍼는 하루 1개씩 주입. 엔진 안에 "실시간" 분기 없음.
- **가짜 클라이언트로 페이지네이션 테스트** — 실키 없이 `Client` 인터페이스만 흉내내
  중복 제거·`since` 컷·`nextBefore` 종료를 검증.

## What Didn't Work

- **PowerShell `Get-Content`/`Set-Content` 라운드트립으로 한글 파일 일괄 치환** →
  한글이 전부 모지바케가 되고 `//` 주석과 다음 줄이 붙어버렸다. 파일 통째로 다시 써서 복구.
  **이 저장소의 한글 파일에는 PowerShell 텍스트 치환을 쓰지 말 것.** Edit 도구를 쓴다.
- **읽을 수 없는 출처들** — `namu.wiki` 403, `truedonshow.com` DNS 실패,
  `developers.tossinvest.com/docs` JS 렌더링(빈 문서), 원저작자 네이버 카페는 로그인 필요.
  이미 다 시도했으니 반복하지 말 것.
- **틀린 테스트 가정 2건** (엔진은 정상이었다):
  - 종가 43 · 별지점 43 을 "매도 미체결"로 가정 → LOC 매도는 `종가 ≥ 지정가` 라 체결된다.
  - 단리에서 "사이클 종료 후 잔금 = 시드" 로 가정 → 종료 직후 새 사이클이 바로 매수해서 잔금이 낮아진다.
    `realized == Σ 사이클 손익` 이라는 불변식으로 교체.
- **같은 날 매도 2건 동시 체결이 애매하다고 판단한 것** — 실제로는 애매하지 않다.
  수량 0 = 사이클 종료. 애매한 건 "1/4 만 체결" / "3/4 만 체결" 쪽이었다.

## 미해결 / 확인 필요

1. **실키로 아무것도 안 돌려봤다.** `.env` 에 `TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET` 넣고
   `node src/scripts/collect.ts TQQQ` 가 첫 검증. 응답 형태가 다르면 `src/api/` 만 고치면 된다.
2. **일봉 `timestamp` 타임존 미검증** — "봉 시작 시각"이 UTC 자정 표기인지 ET 장중 표기인지 불명.
   둘 다 UTC 날짜 = 거래일이라 현재는 UTC 로 자른다(`api/candles.ts:tradingDate`).
   KST 표기면 하루 밀린다. **첫 실응답에서 반드시 확인.**
3. **v4.0 "아래로 단계별 추가 LOC매수"** 계단 수·간격이 출처에 없다.
   현재 전반전 2주문(별지점 아래 / 평단)만 구현. 계단이 늘면 하락일 매수량이 달라진다.
4. 토스 API 에 **LOC 주문 타입이 문서상 없음** — 실주문 단계에서만 문제.

## Next Steps

사용자에게 마지막으로 물어본 것: **스케줄러 먼저 vs 실키로 수집 검증 먼저.** 답을 못 받음.

### A. 페이퍼 트레이딩 (추천 경로)

1. **시뮬 상태 영속화** — `sim_state` 테이블 (`State` + config + 마지막 처리 날짜).
   매 step 커밋. `src/db/candles.ts` 옆에 `src/db/state.ts`.
   → 검증: 저장→로드 왕복이 같은 상태를 주는 테스트.
2. **하루 처리 루프** — 마지막 처리 날짜 다음 거래일부터 오늘까지 갭을 자동 보충.
   백테스트 러너와 같은 `planOrders`/`step` 을 쓴다.
   → 검증: **같은 날짜를 두 번 처리해도 상태가 안 변한다**(멱등성) 테스트.
3. **개장일 판정** — `GET /api/v1/market-calendar/US`. 서머타임 직접 계산 금지.
4. **스케줄러** — 미국 장 마감 후 실행. `node:timers` 로 충분(의존성 0 유지).

### B. 실데이터 검증 (A 보다 먼저 해도 됨)

`.env` 채우고 `collect.ts` 실행 → `timestamp` 타임존 확인 → 실제 TQQQ 몇 년치로 백테스트.
지금까지 백테스트는 **합성 캔들로만** 돌려봤다.

### C. 그 외

다른 버전(v2.2/v3.0), 웹 UI. 둘 다 위 두 개보다 뒤.
