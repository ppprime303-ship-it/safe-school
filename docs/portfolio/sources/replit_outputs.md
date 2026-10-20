> **비식별 처리본** — 원문에서 개인 이메일·GitHub 계정명·세션/문서 링크·미리보기 주소·작업공간 경로만 치환했습니다(처리 내역: `05_비식별_처리_기록.md`). 그 밖의 글자는 바꾸지 않았습니다. 원본은 비공개 보관본에 있습니다.

# Replit 실행 결과 원문

출처: **Replit**(사용자가 Replit Shell에서 실행한 결과를 Claude 대화에 붙여넣은 원문). Claude가 직접 실행한 결과가 아닙니다.

## 2026-10-20 21:19:38 KST

````text
리플릿 shell 실행 결과를 알려줄께 
git fetch && git checkout step-3-dev
  npm install && npm run typecheck
  npm test            # 기존 52건 + 새 17건
  npm run e2e:step2   # 회귀 확인
  npm run e2e:step3   # safeschool_test만 초기화. 브라우저 시연 스키마와 같이 쓰지 마세요
remote: Enumerating objects: 100, done.
remote: Counting objects: 100% (85/85), done.
remote: Compressing objects: 100% (15/15), done.
remote: Total 40 (delta 23), reused 40 (delta 23), pack-reused 0 (from 0)
Unpacking objects: 100% (40/40), 28.72 KiB | 105.00 KiB/s, done.
From https://github.com/[GitHub 계정]/safe-school
 * [new branch]      step-3-dev -> origin/step-3-dev
M   .replit
branch 'step-3-dev' set up to track 'origin/step-3-dev'.
Switched to a new branch 'step-3-dev'

> safe-school@0.1.0 postinstall
> prisma generate

Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v6.19.3) to ./node_modules/@prisma/client in 195ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate


added 3 packages, and audited 221 packages in 5s

57 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

> safe-school@0.1.0 typecheck
> tsc --noEmit


> safe-school@0.1.0 test
> tsx scripts/prepare-test-db.ts && vitest run

[test] 테스트 스키마 'safeschool_test' 에 마이그레이션 적용
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "heliumdb", schema "safeschool_test" at "[DB 호스트 비공개]"

2 migrations found in prisma/migrations


No pending migrations to apply.

 RUN  v4.1.12 /home/runner/workspace

 ❯ tests/events.test.ts (17 tests | 17 failed) 4069ms
     × 훈련 발령은 바로 되고, 최초 유형이 기록되며 감사 로그가 남는다 313ms
     × 실제 상황은 confirmReal 없이는 발령되지 않는다 199ms
     × 학교당 진행 중 상황은 1건이며, 중복 발령은 기존 상황 ID와 함께 409 206ms
     × 복합재난: 유형을 추가하면 최초 유형이 앞에 유지되고, 같은 유형은 중복되지 않는다 195ms
     × 다른 학교의 상황 ID로는 접근할 수 없다(404) 341ms
     × 담임은 배정된 학급만 보고 목록에 보이고, 관리자는 올해 활성 학급 전체가 보인다 186ms
     × 미확인 인원은 서버가 계산하고, 보고자 이름과 버전이 돌아온다 231ms
     × 배정되지 않은 학급은 보고할 수 없다(403) 193ms
     × 다른 학교 학급은 보고할 수 없다(404) 365ms
     × 같은 요청 번호로 다시 보내면 중복 저장 없이 같은 결과를 돌려준다(통신 재시도) 190ms
     × 다른 사람이 먼저 수정했으면 409 version_conflict와 최신 보고를 돌려준다 301ms
     × 합계가 재적을 넘으면 422, 부상자는 대피 인원과 독립적으로 재적 이하이면 된다 309ms
     × 재적을 바꾸면 사유가 필요하고, 첫 보고 시점 학급 재적이 기준으로 남는다 190ms
     × 재적 미확인 학급도 관리자가 현장 인원으로 보고할 수 있다 218ms
     × 상황판은 미보고 학급을 구분하고, 미보고 학생 수와 재적 미확인 학급 수를 따로 센다 230ms
     × 실제 상황 종료는 confirmClose가 필요하고, 종료 후에는 보고·유형 추가가 막히며 최종 집계가 감사 로그에 남는다 196ms
     × 훈련 종료는 확인 플래그 없이도 된다 197ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 17 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/events.test.ts > A1 발령 > 훈련 발령은 바로 되고, 최초 유형이 기록되며 감사 로그가 남는다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (30265c7a-17b9-42dd-98f3-1dab459009c9, A학교, a, null, null, null, f, 2026-10-20 12:18:21.761+00, 2026-10-20 12:18:21.761+00, active, null, null, null, manual, null, 2026-10-20 12:18:21.758+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/17]⎯

 FAIL  tests/events.test.ts > A1 발령 > 실제 상황은 confirmReal 없이는 발령되지 않는다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (a164d565-b540-4be4-b7c6-c9cd79c437e4, A학교, a, null, null, null, f, 2026-10-20 12:18:21.969+00, 2026-10-20 12:18:21.969+00, active, null, null, null, manual, null, 2026-10-20 12:18:21.968+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/17]⎯

 FAIL  tests/events.test.ts > A1 발령 > 학교당 진행 중 상황은 1건이며, 중복 발령은 기존 상황 ID와 함께 409
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (882eb163-a86a-46ea-bd97-b86ac19de54e, A학교, a, null, null, null, f, 2026-10-20 12:18:22.176+00, 2026-10-20 12:18:22.176+00, active, null, null, null, manual, null, 2026-10-20 12:18:22.175+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/17]⎯

 FAIL  tests/events.test.ts > A1 발령 > 복합재난: 유형을 추가하면 최초 유형이 앞에 유지되고, 같은 유형은 중복되지 않는다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (351e24ed-baa0-4d7f-a40c-1c31267c0c19, A학교, a, null, null, null, f, 2026-10-20 12:18:22.371+00, 2026-10-20 12:18:22.371+00, active, null, null, null, manual, null, 2026-10-20 12:18:22.37+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/17]⎯

 FAIL  tests/events.test.ts > A1 발령 > 다른 학교의 상황 ID로는 접근할 수 없다(404)
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (98fe99fa-6930-42de-b45b-0b2568bf86f1, A학교, a, null, null, null, f, 2026-10-20 12:18:22.711+00, 2026-10-20 12:18:22.711+00, active, null, null, null, manual, null, 2026-10-20 12:18:22.71+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 담임은 배정된 학급만 보고 목록에 보이고, 관리자는 올해 활성 학급 전체가 보인다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (d7987462-ec1c-414e-907a-469faa6752f0, A학교, a, null, null, null, f, 2026-10-20 12:18:22.899+00, 2026-10-20 12:18:22.899+00, active, null, null, null, manual, null, 2026-10-20 12:18:22.898+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 미확인 인원은 서버가 계산하고, 보고자 이름과 버전이 돌아온다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (bd638a53-2c12-442d-93d7-4a2db6d63f8f, A학교, a, null, null, null, f, 2026-10-20 12:18:23.13+00, 2026-10-20 12:18:23.13+00, active, null, null, null, manual, null, 2026-10-20 12:18:23.129+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 배정되지 않은 학급은 보고할 수 없다(403)
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (e7bb8fc0-68d6-479d-b151-10d4293fc5d2, A학교, a, null, null, null, f, 2026-10-20 12:18:23.323+00, 2026-10-20 12:18:23.323+00, active, null, null, null, manual, null, 2026-10-20 12:18:23.322+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 다른 학교 학급은 보고할 수 없다(404)
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (4cf7a0b1-0cc1-43fa-9eaf-9b2c651b7c9a, A학교, a, null, null, null, f, 2026-10-20 12:18:23.686+00, 2026-10-20 12:18:23.686+00, active, null, null, null, manual, null, 2026-10-20 12:18:23.685+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 같은 요청 번호로 다시 보내면 중복 저장 없이 같은 결과를 돌려준다(통신 재시도)
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (bb1c6b7b-1669-471f-a769-1ef40bb955d2, A학교, a, null, null, null, f, 2026-10-20 12:18:23.875+00, 2026-10-20 12:18:23.875+00, active, null, null, null, manual, null, 2026-10-20 12:18:23.87+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 다른 사람이 먼저 수정했으면 409 version_conflict와 최신 보고를 돌려준다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (9e3bdea6-8e89-4445-a408-7db63f258030, A학교, a, null, null, null, f, 2026-10-20 12:18:24.178+00, 2026-10-20 12:18:24.178+00, active, null, null, null, manual, null, 2026-10-20 12:18:24.177+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 합계가 재적을 넘으면 422, 부상자는 대피 인원과 독립적으로 재적 이하이면 된다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (601a8580-d945-42bc-93d6-4f65cdf7636d, A학교, a, null, null, null, f, 2026-10-20 12:18:24.488+00, 2026-10-20 12:18:24.488+00, active, null, null, null, manual, null, 2026-10-20 12:18:24.487+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 재적을 바꾸면 사유가 필요하고, 첫 보고 시점 학급 재적이 기준으로 남는다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (4768e1b9-67c7-4ce9-a0be-e980b1213f2a, A학교, a, null, null, null, f, 2026-10-20 12:18:24.678+00, 2026-10-20 12:18:24.678+00, active, null, null, null, manual, null, 2026-10-20 12:18:24.676+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/17]⎯

 FAIL  tests/events.test.ts > A2 학급 보고 > 재적 미확인 학급도 관리자가 현장 인원으로 보고할 수 있다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (cd019103-aa53-49c4-a38d-a1a93de69c27, A학교, a, null, null, null, f, 2026-10-20 12:18:24.895+00, 2026-10-20 12:18:24.895+00, active, null, null, null, manual, null, 2026-10-20 12:18:24.894+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/17]⎯

 FAIL  tests/events.test.ts > A3 상황판·종료 > 상황판은 미보고 학급을 구분하고, 미보고 학생 수와 재적 미확인 학급 수를 따로 센다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (97237ba8-8876-41a1-8338-87e56f6b4237, A학교, a, null, null, null, f, 2026-10-20 12:18:25.128+00, 2026-10-20 12:18:25.128+00, active, null, null, null, manual, null, 2026-10-20 12:18:25.126+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[15/17]⎯

 FAIL  tests/events.test.ts > A3 상황판·종료 > 실제 상황 종료는 confirmClose가 필요하고, 종료 후에는 보고·유형 추가가 막히며 최종 집계가 감사 로그에 남는다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (e985203f-afb1-4cb4-892e-7211fa73491c, A학교, a, null, null, null, f, 2026-10-20 12:18:25.325+00, 2026-10-20 12:18:25.325+00, active, null, null, null, manual, null, 2026-10-20 12:18:25.324+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[16/17]⎯

 FAIL  tests/events.test.ts > A3 상황판·종료 > 훈련 종료는 확인 플래그 없이도 된다
PrismaClientUnknownRequestError: 
Invalid `prisma.school.create()` invocation in
/home/runner/workspace/tests/events.test.ts:53:34

  50 beforeEach(async () => {
  51   await resetTestData(prisma);
  52   const now = new Date();
→ 53   schoolA = (await prisma.school.create(
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \"schools\" violates check constraint \"schools_slug_format\"", severity: "ERROR", detail: Some("Failing row contains (5604858b-ecc9-4f8f-9c6a-c3e3cccc157b, A학교, a, null, null, null, f, 2026-10-20 12:18:25.521+00, 2026-10-20 12:18:25.521+00, active, null, null, null, manual, null, 2026-10-20 12:18:25.52+00)."), column: None, hint: None }), transient: false })
 ❯ ei.handleRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:237:12
 ❯ ei.handleAndLogRequestError node_modules/@prisma/client/src/runtime/RequestHandler.ts:174:11
 ❯ ei.request node_modules/@prisma/client/src/runtime/RequestHandler.ts:143:11
 ❯ a node_modules/@prisma/client/src/runtime/getPrismaClient.ts:833:23
 ❯ tests/events.test.ts:53:14
     51|   await resetTestData(prisma);
     52|   const now = new Date();
     53|   schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "a", status: "active",…
       |              ^
     54|   schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "b", status: "active",…
     55|   adminUser = (await prisma.user.create({ data: { email: "[이메일 비공개]", displayName: "관리자", …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[17/17]⎯


 Test Files  1 failed | 5 passed (6)
      Tests  17 failed | 52 passed (69)
   Start at  12:18:15
   Duration  14.94s (transform 329ms, setup 0ms, import 621ms, tests 13.37s, environment 1ms)


> safe-school@0.1.0 e2e:step2
> tsx scripts/e2e-step2.ts

[e2e] 테스트 스키마에 마이그레이션 적용
[e2e] 테스트 서버 시작(포트 5099, NODE_ENV=test, 모의 메일)

1. 세션·보안
  ✓ 로그인 없이 내 정보 요청 → 401
  ✓ JSON이 아닌 변경 요청 거부(CSRF 대응) → 415

2. 최초 등록자(관리자 후보)
  ✓ 관리자후보 가입 요청(모의 발송, 코드는 테스트에서만 반환)
  ✓ 관리자후보 미인증 계정 재가입으로 비밀번호 변경 차단
  ✓ 관리자후보 틀린 인증코드 거부
  ✓ 관리자후보 이메일 인증 → 로그인됨
  ✓ 학교명 검색 → 미등록 학교 표시
  ✓ 최초 학교 등록 신청 → 관리자 승인 대기
  ✓ 자격 확인 전 관리자 기능 차단(첫 신청자 자동 권한 없음)

3. 운영자 자격 확인 → 학교 활성화
  ✓ 승인 후 관리자·학교 활성

4. 학급 만들기·재적 일괄 저장
  ✓ 학년별 학급 수로 학급 3개 생성
  ✓ 재적은 미확인(빈 값)으로 시작
  ✓ 한 번에 3개 학급 재적 저장
  ✓ 재적 61명 입력 거부

5. 후속 교직원 가입
  ✓ 담임교사 가입 요청(모의 발송, 코드는 테스트에서만 반환)
  ✓ 담임교사 미인증 계정 재가입으로 비밀번호 변경 차단
  ✓ 담임교사 틀린 인증코드 거부
  ✓ 담임교사 이메일 인증 → 로그인됨
  ✓ 같은 학교 검색 → '등록된 학교'로 표시
  ✓ 같은 학교 중복 등록 거부 → 가입 안내
  ✓ 기존 학교에 가입 신청 → 승인 대기
  ✓ 승인 전 학급 데이터 접근 차단
  ✓ 승인 전 관리자 기능 차단

6. 관리자 일괄 승인·배정
  ✓ 승인 대기 목록에 1명
  ✓ 일괄 승인
  ✓ 같은 승인 다시 요청해도 중복 처리 없음
  ✓ 담당 학급 배정
  ✓ 담임은 관리자 기능 사용 불가

7. 로그아웃 → 로그인
  ✓ 로그아웃 후 401
  ✓ 틀린 비밀번호 거부
  ✓ 공용 기기로 로그인
  ✓ 로그인 후 담당 학급 자동 표시
  ✓ 승인 후 학급 조회 가능

8. 다른 학교 사용자 격리
  ✓ 외부인 가입 요청(모의 발송, 코드는 테스트에서만 반환)
  ✓ 외부인 미인증 계정 재가입으로 비밀번호 변경 차단
  ✓ 외부인 틀린 인증코드 거부
  ✓ 외부인 이메일 인증 → 로그인됨
  ✓ 소속 없는 사용자 → 404(존재도 숨김)
  ✓ 공용 기기 세션: 30분 미사용 만료·8시간 이내 절대 만료
  ✓ 주요 행위가 감사 로그에 기록됨

[e2e] 결과: 40개 통과, 0개 실패

> safe-school@0.1.0 e2e:step3
> tsx scripts/e2e-step3.ts

[e2e:step3] 테스트 스키마에 마이그레이션 적용
[e2e:step3] 테스트 서버 시작(포트 5098, NODE_ENV=test, 모의 메일)

1. 평상시·권한
  ✓ 로그인 없이 진행 중 상황 조회 → 401
  ✓ 평상시 담임 조회 → 진행 중 상황 없음
  ✓ 담임은 발령할 수 없음 → 403
  ✓ 다른 학교 관리자는 발령할 수 없음 → 404

2. 훈련 발령
  ✓ 실제 상황은 확인 없이 발령 불가 → 400 confirm_required
  ✓ 관리자 훈련 발령 → 201
  ✓ 중복 발령 → 409 + 기존 상황 ID
  ✓ 담임 화면에 진행 중 상황 표시
  ✓ 다른 학교 관리자는 상황판 접근 불가 → 404

3. 담당 학급 보고
  ✓ 담임은 배정된 1-1만 보임
  ✓ 배정 없는 교직원은 빈 목록
  ✓ 요청 번호 없는 보고 거부 → 400
  ✓ 배정되지 않은 학급 보고 → 403
  ✓ 합계가 재적 초과 → 422 sum_mismatch
  ✓ 담임 보고 저장 → 미확인 1명 서버 계산, 보고자 이름
  ✓ 같은 요청 재전송 → 중복 저장 없음
  ✓ 관리자 대리 수정 → 버전 2
  ✓ 이전 버전 기준 수정 → 409 version_conflict(최신 보고 포함)
  ✓ 수정 이력 2건 보존

4. 상황판
  ✓ 담임은 상황판 접근 불가 → 403
  ✓ 상황판: 3개 학급 중 1개 보고, 미보고 학생 30명, 재적 미확인 1개 학급
  ✓ 복합재난 유형 추가 → 최초 유형 유지

5. 종료
  ✓ 담임은 종료할 수 없음 → 403
  ✓ 훈련 종료 → 최종 집계 반환
  ✓ 종료 후 보고 → 409 event_closed
  ✓ 종료 후 진행 중 상황 없음

6. 실제 상황(확인 절차)
  ✓ 실제 상황 발령(확인 포함) → 201
  ✓ 실제 상황 종료는 확인 없이 불가 → 400
  ✓ 실제 상황 종료(확인 포함) → 200
  ✓ 발령·보고·대리 수정·유형 추가·종료가 감사 로그에 기록됨

[e2e:step3] 결과: 30개 통과, 0개 실패
````

## 2026-10-20 21:23:25 KST

````text
git pull
npm run typecheck
npm test            # 기대: 69건(기존 52 + 새 17)
npm run e2e:step2   # 기대: 40/40
npm run e2e:step3   # 기대: 40개 안팎. safeschool_test만 초기화합니다
remote: Enumerating objects: 47, done.
remote: Counting objects: 100% (45/45), done.
remote: Compressing objects: 100% (5/5), done.
remote: Total 15 (delta 10), reused 15 (delta 10), pack-reused 0 (from 0)
Unpacking objects: 100% (15/15), 6.80 KiB | 136.00 KiB/s, done.
From https://github.com/[GitHub 계정]/safe-school
   24940e3..9345f2a  step-3-dev -> origin/step-3-dev
Updating 24940e3..9345f2a
Fast-forward
 client/src/pages/report/ReportPage.tsx | 22 ++++++++++++++++++++++
 docs/demo-step3.md                     | 36 ++++++++++++++++++++++++++++++++++++
 docs/step3-progress.md                 | 46 ++++++++++++++++++++++++++++++++++++++++++++++
 docs/test-record.md                    |  7 +++++--
 scripts/e2e-step3.ts                   | 46 ++++++++++++++++++++++++++++++++++++++++------
 tests/events.test.ts                   |  4 ++--
 6 files changed, 151 insertions(+), 10 deletions(-)
 create mode 100644 docs/demo-step3.md
 create mode 100644 docs/step3-progress.md

> safe-school@0.1.0 typecheck
> tsc --noEmit


> safe-school@0.1.0 test
> tsx scripts/prepare-test-db.ts && vitest run

[test] 테스트 스키마 'safeschool_test' 에 마이그레이션 적용
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "heliumdb", schema "safeschool_test" at "[DB 호스트 비공개]"

2 migrations found in prisma/migrations


No pending migrations to apply.

 RUN  v4.1.12 /home/runner/workspace


 Test Files  6 passed (6)
      Tests  69 passed (69)
   Start at  12:21:35
   Duration  17.38s (transform 352ms, setup 0ms, import 631ms, tests 15.76s, environment 0ms)


> safe-school@0.1.0 e2e:step2
> tsx scripts/e2e-step2.ts

[e2e] 테스트 스키마에 마이그레이션 적용
[e2e] 테스트 서버 시작(포트 5099, NODE_ENV=test, 모의 메일)

1. 세션·보안
  ✓ 로그인 없이 내 정보 요청 → 401
  ✓ JSON이 아닌 변경 요청 거부(CSRF 대응) → 415

2. 최초 등록자(관리자 후보)
  ✓ 관리자후보 가입 요청(모의 발송, 코드는 테스트에서만 반환)
  ✓ 관리자후보 미인증 계정 재가입으로 비밀번호 변경 차단
  ✓ 관리자후보 틀린 인증코드 거부
  ✓ 관리자후보 이메일 인증 → 로그인됨
  ✓ 학교명 검색 → 미등록 학교 표시
  ✓ 최초 학교 등록 신청 → 관리자 승인 대기
  ✓ 자격 확인 전 관리자 기능 차단(첫 신청자 자동 권한 없음)

3. 운영자 자격 확인 → 학교 활성화
  ✓ 승인 후 관리자·학교 활성

4. 학급 만들기·재적 일괄 저장
  ✓ 학년별 학급 수로 학급 3개 생성
  ✓ 재적은 미확인(빈 값)으로 시작
  ✓ 한 번에 3개 학급 재적 저장
  ✓ 재적 61명 입력 거부

5. 후속 교직원 가입
  ✓ 담임교사 가입 요청(모의 발송, 코드는 테스트에서만 반환)
  ✓ 담임교사 미인증 계정 재가입으로 비밀번호 변경 차단
  ✓ 담임교사 틀린 인증코드 거부
  ✓ 담임교사 이메일 인증 → 로그인됨
  ✓ 같은 학교 검색 → '등록된 학교'로 표시
  ✓ 같은 학교 중복 등록 거부 → 가입 안내
  ✓ 기존 학교에 가입 신청 → 승인 대기
  ✓ 승인 전 학급 데이터 접근 차단
  ✓ 승인 전 관리자 기능 차단

6. 관리자 일괄 승인·배정
  ✓ 승인 대기 목록에 1명
  ✓ 일괄 승인
  ✓ 같은 승인 다시 요청해도 중복 처리 없음
  ✓ 담당 학급 배정
  ✓ 담임은 관리자 기능 사용 불가

7. 로그아웃 → 로그인
  ✓ 로그아웃 후 401
  ✓ 틀린 비밀번호 거부
  ✓ 공용 기기로 로그인
  ✓ 로그인 후 담당 학급 자동 표시
  ✓ 승인 후 학급 조회 가능

8. 다른 학교 사용자 격리
  ✓ 외부인 가입 요청(모의 발송, 코드는 테스트에서만 반환)
  ✓ 외부인 미인증 계정 재가입으로 비밀번호 변경 차단
  ✓ 외부인 틀린 인증코드 거부
  ✓ 외부인 이메일 인증 → 로그인됨
  ✓ 소속 없는 사용자 → 404(존재도 숨김)
node:events:497
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use 0.0.0.0:5099
    at Server.setupListenHandle [as _listen2] (node:net:1940:16)
    at listenInCluster (node:net:1997:12)
    at node:net:2206:7
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
Emitted 'error' event on Server instance at:
    at emitErrorNT (node:net:1976:8)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
  code: 'EADDRINUSE',
  errno: -98,
  syscall: 'listen',
  address: '0.0.0.0',
  port: 5099
}

Node.js v22.22.0
  ✓ 공용 기기 세션: 30분 미사용 만료·8시간 이내 절대 만료
  ✓ 주요 행위가 감사 로그에 기록됨

[e2e] 결과: 40개 통과, 0개 실패

> safe-school@0.1.0 e2e:step3
> tsx scripts/e2e-step3.ts

[e2e:step3] 테스트 스키마에 마이그레이션 적용
[e2e:step3] 테스트 서버 시작(포트 5098, NODE_ENV=test, 모의 메일)

1. 평상시·권한
  ✓ 로그인 없이 진행 중 상황 조회 → 401
  ✓ 평상시 담임 조회 → 진행 중 상황 없음
  ✓ 담임은 발령할 수 없음 → 403
  ✓ 승인 대기 교직원은 재난 정보 접근 불가 → 403 membership_pending
  ✓ 다른 학교 관리자는 발령할 수 없음 → 404

2. 훈련 발령
  ✓ 실제 상황은 확인 없이 발령 불가 → 400 confirm_required
  ✓ 관리자 훈련 발령 → 201
  ✓ 중복 발령 → 409 + 기존 상황 ID
  ✓ 담임 화면에 진행 중 상황 표시
  ✓ 다른 학교 관리자는 상황판 접근 불가 → 404

3. 담당 학급 보고
  ✓ 담임은 배정된 1-1만 보임
  ✓ 배정 없는 교직원은 빈 목록
  ✓ 요청 번호 없는 보고 거부 → 400
  ✓ 배정되지 않은 학급 보고 → 403
  ✓ 합계가 재적 초과 → 422 sum_mismatch
  ✓ 담임 보고 저장 → 미확인 1명 서버 계산, 보고자 이름
  ✓ 같은 요청 재전송 → 중복 저장 없음
  ✓ 관리자 대리 수정 → 버전 2
  ✓ 이전 버전 기준 수정 → 409 version_conflict(최신 보고 포함)
  ✓ 수정 이력 2건 보존

4. 상황판
  ✓ 담임은 상황판 접근 불가 → 403
  ✓ 상황판: 3개 학급 중 1개 보고, 미보고 학생 30명, 재적 미확인 1개 학급
  ✓ 복합재난 유형 추가 → 최초 유형 유지

5. 종료
  ✓ 담임은 종료할 수 없음 → 403
  ✓ 훈련 종료 → 최종 집계 반환
  ✓ 종료 후 보고 → 409 event_closed
  ✓ 종료 후 진행 중 상황 없음

6. 실제 상황(확인 절차)
  ✓ 실제 상황 발령(확인 포함) → 201
node:events:497
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use 0.0.0.0:5098
    at Server.setupListenHandle [as _listen2] (node:net:1940:16)
    at listenInCluster (node:net:1997:12)
    at node:net:2206:7
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
Emitted 'error' event on Server instance at:
    at emitErrorNT (node:net:1976:8)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
  code: 'EADDRINUSE',
  errno: -98,
  syscall: 'listen',
  address: '0.0.0.0',
  port: 5098
}

Node.js v22.22.0
  ✓ 실제 상황 종료는 확인 없이 불가 → 400
  ✓ 실제 상황 종료(확인 포함) → 200

7. 10/23 시연 시나리오(지진 훈련, 1학년 1반 재적 25명)
  ✓ 관리자 지진 모의훈련 발령
  ✓ 담임 화면에 훈련이 바로 표시됨
  ✓ 담임 1학년 1반·재적 25명 자동 표시
  ✓ 24명 대피 보고 → 미확인 1명
  ✓ 상황판: 1-1 미확인 1명, 나머지 2개 학급 미보고
  ✓ 재보고: 25명 전원 대피 → 미확인 0명, 버전 2
  ✓ 상황판 수치 갱신: 대피 25명·미확인 0명
  ✓ 훈련 종료
  ✓ 종료 후 수정 보고 차단 → 409 event_closed
  ✓ 종료 감사 기록(최종 집계 포함)
  ✓ 발령·보고·대리 수정·유형 추가·종료가 감사 로그에 기록됨

[e2e:step3] 결과: 41개 통과, 0개 실패
~/workspace$
````

## 2026-10-20 21:51:59 KST

````text
SAFE SCHOOL STEP 3-A 최종 검증 결과를 전달합니다.
자동 테스트

* `npm run typecheck`: 오류 없이 통과
* `npm test`: 6개 테스트 파일, 69/69 통과
* `npm run e2e:step2`: 40/40 통과
* `npm run e2e:step3`: 41/41 통과
* 총 150개 자동 테스트 통과, 실패 0건

브라우저 검증

* 관리자 지진 모의훈련 발령 성공
* 담임교사 1학년 1반·재적 25명 자동 표시
* 24명 대피 보고 → 관리자 상황판 미확인 1명 확인
* 25명 전원 대피 수정 보고 → 미확인 0명 확인
* 상황 종료 및 이후 보고 차단 정상
* 발령·보고 생성·수정·종료 감사 로그 4건 확인

STEP 3-A를 핵심 기능 검증 완료 상태로 기록해 주세요.
다음 작업:

1. STEP 3-A 검증 결과를 `docs/test-record.md`에 반영
2. 검증된 코드의 커밋·브랜치 상태 확인
3. 기존 STEP 1~3-A 기능과 DB 데이터 보존
4. STEP 3-B 국가 재난경보 자동 수집 및 학교별 알림 기능 개발 착수

STEP 3-B는 공식 경보 수집, 학교 지역 매칭, 중복 경보 방지, 교직원 앱 내 알림 순서로 구현해 주세요.
학부모 대상 외부 자동 발송은 아직 활성화하지 말고, 학교 관리자 승인 및 모의 발송부터 개발해 주세요.
매 단계마다 변경 파일, 커밋, 테스트 결과, Replit 실행 명령을 안내해 주세요.SAFE SCHOOL STEP 3-A 최종 검증 결과를 전달합니다.
자동 테스트

* `npm run typecheck`: 오류 없이 통과
* `npm test`: 6개 테스트 파일, 69/69 통과
* `npm run e2e:step2`: 40/40 통과
* `npm run e2e:step3`: 41/41 통과
* 총 150개 자동 테스트 통과, 실패 0건

브라우저 검증

* 관리자 지진 모의훈련 발령 성공
* 담임교사 1학년 1반·재적 25명 자동 표시
* 24명 대피 보고 → 관리자 상황판 미확인 1명 확인
* 25명 전원 대피 수정 보고 → 미확인 0명 확인
* 상황 종료 및 이후 보고 차단 정상
* 발령·보고 생성·수정·종료 감사 로그 4건 확인

STEP 3-A를 핵심 기능 검증 완료 상태로 기록해 주세요.
다음 작업:

1. STEP 3-A 검증 결과를 `docs/test-record.md`에 반영
2. 검증된 코드의 커밋·브랜치 상태 확인
3. 기존 STEP 1~3-A 기능과 DB 데이터 보존
4. STEP 3-B 국가 재난경보 자동 수집 및 학교별 알림 기능 개발 착수

STEP 3-B는 공식 경보 수집, 학교 지역 매칭, 중복 경보 방지, 교직원 앱 내 알림 순서로 구현해 주세요.
학부모 대상 외부 자동 발송은 아직 활성화하지 말고, 학교 관리자 승인 및 모의 발송부터 개발해 주세요.
매 단계마다 변경 파일, 커밋, 테스트 결과, Replit 실행 명령을 안내해 주세요.
````

