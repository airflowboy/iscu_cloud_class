# 13주차 실습 — original_url → destination_url (Parallel Change)

## 문제 1. Expand

| 질문 | 나의 답 |
|---|---|
| DB 변경과 코드 배포 중 무엇을 먼저 해야 하는가? | **DB 변경을 먼저** 한다. `ALTER TABLE urls ADD COLUMN destination_url VARCHAR(2048);` 을 실행한 뒤에 두 컬럼에 함께 저장하는 코드를 배포한다. 코드를 먼저 배포하면 없는 컬럼에 INSERT해서 URL 생성이 실패한다. 새 컬럼은 NULL 허용이라 기존 코드(original_url만 INSERT)도 그대로 동작하고, 문제가 생겨 직전 배포로 Rollback해도 안전하다. |

## 문제 2. Migrate

| 질문 | 나의 답 |
|---|---|
| 기존 행의 destination_url은 어떻게 채우는가(Backfill)? | Dual Write 코드를 배포한 **뒤에** `UPDATE urls SET destination_url = original_url WHERE destination_url IS NULL;` 을 실행한다. 배포 전에 하면 그 사이 옛 코드가 만든 행이 다시 비어 남는다. `WHERE destination_url IS NULL` 이라 여러 번 실행해도 안전하다. |
| 어떤 함수의 조회 컬럼을 변경해야 하는가? | `lib/db.js` 의 `findUrlByShortCode()`(Redirect), `lib/stats.js` 의 `getTopUrl()`·`getUrlStats()`(관리자 화면). 이 저장소에는 하나 더 있다: 중복 URL 확인용 `lib/db.js` 의 `findShortCodeByUrl()`(`WHERE original_url = ...`). 교안 표에는 없지만 빠뜨리면 Contract 뒤 같은 URL 중복 확인이 깨진다. |
| 조회를 전환하기 전에 데이터가 모두 이전되었는지 어떻게 확인할 수 있는가? | `SELECT count(*) FILTER (WHERE destination_url IS NULL), count(*) FILTER (WHERE destination_url IS DISTINCT FROM original_url) FROM urls;` 두 값이 모두 0이어야 한다. |
| 새 컬럼을 읽는 코드에서도 왜 original_url에 계속 저장해야 하는가? | ① Rollback 대상(직전 배포)은 아직 original_url을 읽으므로, 새 코드가 만든 URL도 되돌렸을 때 Redirect돼야 한다. ② original_url에 NOT NULL 제약이 있어서 빼고 INSERT하면 URL 생성이 실패한다. |

## 문제 3. Contract

| 질문 | 나의 답 |
|---|---|
| destination_url에만 저장하는 코드를 배포하기 전에 어떤 SQL 작업이 필요한가? | `ALTER TABLE urls ALTER COLUMN original_url DROP NOT NULL;` (안 하면 INSERT 실패). 함께 `ALTER COLUMN destination_url SET NOT NULL;` 로 새 컬럼에 원래 제약을 옮긴다(NULL 0건 확인 뒤). |
| 현재 코드는 새 컬럼만 사용하더라도, 이전 버전으로 Rollback하면 어떤 문제가 발생하는가? | 직전 배포(Migrate 판)는 original_url에도 INSERT한다. original_url을 이미 지웠다면 Rollback한 순간 URL 생성이 500으로 실패한다. 또 새 코드가 만든 행은 original_url이 NULL이라, original_url을 읽는 더 옛 코드로 돌아가면 그 URL들이 404가 된다. |
| 기존 컬럼을 삭제하기 전에 실행 중인 코드와 Rollback 대상 코드에서 무엇을 확인해야 하는가? | 두 배포 모두 코드 어디에도 original_url이 없는지(`grep -rn original_url lib app` 결과 0). Hobby 플랜은 바로 직전 배포로만 Rollback되므로, destination_url 전용 코드를 **한 번 더 배포**해 직전 배포도 그 코드가 되게 한 뒤 삭제한다. DB 쪽은 original_url을 참조하는 뷰·인덱스가 없는지, destination_url NULL이 0건인지 확인한다. |

## 실제 운영 반영 순서 (2026-11-23, Neon production · Vercel Hobby)

| # | 작업 | 운영 코드 / 직전 배포 | 확인 |
|---|---|---|---|
| 0 | 시작 상태 기록 | week10 | 기존 307 · 없는 코드 404 · 생성 201 · 재요청 200 |
| 1 | SQL `ADD COLUMN destination_url VARCHAR(2048)` | week10 | 옛 코드 그대로 정상 |
| 2 | 배포 `924059a` saveUrl Dual Write | 924059a / week10 | 새 행 두 컬럼 다 채워짐 |
| 3 | SQL Backfill | 〃 | 7행 중 NULL 0 · 불일치 0 |
| 4 | 배포 `ac52d2b` 조회 4곳 destination_url | ac52d2b / 924059a | 옛 행이 캐시 MISS로 DB에서 307 |
| 5 | SQL original_url DROP NOT NULL, destination_url SET NOT NULL | 〃 | is_nullable 확인 |
| 6 | 배포 `f3527b3` destination_url에만 저장 | f3527b3 / ac52d2b | 새 행 original_url 비어 있음 |
| 7 | 배포 `c54c7da` (주석 한 줄, 직전 배포를 f3527b3로) | c54c7da / f3527b3 | 정상 |
| 8 | SQL `DROP COLUMN original_url` | 〃 | 컬럼 5개, 옛 주소 5개·새 주소 모두 307 |

틀린 순서(Expand 전에 Dual Write 배포, Backfill 없이 조회 전환, NOT NULL 풀기 전에 단일 저장, 직전 배포가 original_url을 쓰는데 컬럼 삭제 등 5가지)는 로컬 Postgres로 실제로 실패하는 것을 먼저 확인했다.
