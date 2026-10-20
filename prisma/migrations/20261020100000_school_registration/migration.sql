-- SAFE SCHOOL 마이그레이션 2: 학교 등록·교직원 가입 구조, 학교알리미 공시자료
-- 원칙: 기존 데이터를 삭제하지 않습니다. 새 열은 기존 행에 안전한 기본값을 채웁니다.
-- 바뀌는 인덱스 1개(classes의 UNIQUE)는 '학년도'를 키에 넣기 위해 새 인덱스로 교체합니다(데이터 변화 없음).

-- ───────────── 열거형 ─────────────
CREATE TYPE "SchoolStatus" AS ENUM ('pending_verification', 'active', 'suspended');
CREATE TYPE "DataSource" AS ENUM ('schoolinfo', 'neis', 'manual');
CREATE TYPE "RegistrationStatus" AS ENUM ('pending_verification', 'approved', 'rejected', 'withdrawn');

-- ───────────── 학교: 상태·출처 ─────────────
-- 기존 학교(데모)는 이미 운영 중이므로 'active'로 채운 뒤, 새 학교의 기본값을 '관리자 승인 대기'로 바꿉니다.
ALTER TABLE "schools"
  ADD COLUMN "status"           "SchoolStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "school_kind_code" TEXT,          -- 학교알리미 학교급 코드(02 초, 03 중, 04 고 …)
  ADD COLUMN "address"          TEXT,
  ADD COLUMN "edu_office_name"  TEXT,
  ADD COLUMN "info_source"      "DataSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "info_synced_at"   TIMESTAMPTZ,
  ADD COLUMN "activated_at"     TIMESTAMPTZ;
UPDATE "schools" SET "activated_at" = "created_at" WHERE "status" = 'active' AND "activated_at" IS NULL;
ALTER TABLE "schools" ALTER COLUMN "status" SET DEFAULT 'pending_verification';
ALTER TABLE "schools" ADD CONSTRAINT "schools_active_has_activated_at"
  CHECK ("status" <> 'active' OR "activated_at" IS NOT NULL);
COMMENT ON COLUMN "schools"."neis_code" IS '사용 중단 예정: 외부 식별코드는 school_external_ids 사용';

-- ───────────── 외부 식별코드 매핑(학교알리미·향후 나이스) ─────────────
-- 같은 공식 코드로 학교를 두 번 만들 수 없게 합니다. 나이스 연동 시 기존 학교에 코드만 추가합니다.
CREATE TABLE "school_external_ids" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"     UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "source"        "DataSource" NOT NULL,
  "external_code" TEXT NOT NULL,
  "linked_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "school_external_ids_not_manual" CHECK ("source" <> 'manual'),
  CONSTRAINT "school_external_ids_code_not_blank" CHECK (length(trim("external_code")) > 0)
);
CREATE UNIQUE INDEX "school_external_ids_source_code_key" ON "school_external_ids" ("source", "external_code");
CREATE UNIQUE INDEX "school_external_ids_school_source_key" ON "school_external_ids" ("school_id", "source");

-- ───────────── 학교 검색용 공공데이터 목록(캐시) ─────────────
-- 등록된 학교와 별개입니다. API 장애 때도 마지막으로 받은 목록으로 검색할 수 있게 저장합니다.
CREATE TABLE "school_directory_entries" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"          "DataSource" NOT NULL,
  "external_code"   TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "kind_code"       TEXT,
  "sido_code"       TEXT,
  "edu_office_name" TEXT,
  "address"         TEXT,
  "closed"          BOOLEAN NOT NULL DEFAULT false,
  "raw"             JSONB NOT NULL,
  "synced_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "school_directory_entries_source_code_key" ON "school_directory_entries" ("source", "external_code");
CREATE INDEX "school_directory_entries_kind_sido_idx" ON "school_directory_entries" ("kind_code", "sido_code");

-- ───────────── 최초 학교 등록 신청과 관리자 자격 확인 ─────────────
CREATE TABLE "school_registrations" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"           UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "applicant_user_id"   UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "applicant_position"  TEXT,               -- 신청자가 적은 직위(예: 교감, 안전업무 담당)
  "status"              "RegistrationStatus" NOT NULL DEFAULT 'pending_verification',
  "verification_method" TEXT,               -- 자격 확인 방법(예: 공문, 학교 대표전화 확인)
  "verification_note"   TEXT,
  "reviewed_by"         TEXT,               -- 확인한 운영자(학교 사용자가 아니므로 이름·식별자 문자열)
  "reviewed_at"         TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "school_registrations_reviewed"
    CHECK ("status" NOT IN ('approved', 'rejected') OR ("reviewed_at" IS NOT NULL AND "reviewed_by" IS NOT NULL)),
  CONSTRAINT "school_registrations_approved_has_method"
    CHECK ("status" <> 'approved' OR "verification_method" IS NOT NULL)
);
-- 학교당 대기 중인 신청 1건, 승인된 신청 1건
CREATE UNIQUE INDEX "school_registrations_one_pending" ON "school_registrations" ("school_id") WHERE "status" = 'pending_verification';
CREATE UNIQUE INDEX "school_registrations_one_approved" ON "school_registrations" ("school_id") WHERE "status" = 'approved';
CREATE INDEX "school_registrations_applicant_idx" ON "school_registrations" ("applicant_user_id");

-- ───────────── 공시자료 스냅숏(출처·기준일 보관) ─────────────
-- 실제 운영 데이터(classes 등)를 자동으로 덮어쓰지 않습니다. 관리자가 확인할 참고자료입니다.
CREATE TABLE "school_public_data_snapshots" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"       UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "source"          "DataSource" NOT NULL,
  "dataset"         TEXT NOT NULL,          -- 'basic_info' | 'grade_class_students'
  "api_type"        TEXT,
  "disclosure_year" INTEGER,                -- 공시연도(pbanYr)
  "base_date"       DATE,                   -- 공시 기준일(응답에 있을 때만)
  "source_url"      TEXT NOT NULL,          -- 출처(인증키 제외)
  "payload"         JSONB NOT NULL,         -- 원본 응답 행
  "parsed"          JSONB,                  -- 정리된 값(학년별 학급수·학생수 등)
  "payload_hash"    TEXT NOT NULL,
  "fetched_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "snapshots_not_manual" CHECK ("source" <> 'manual')
);
CREATE UNIQUE INDEX "school_public_data_snapshots_dedupe_key"
  ON "school_public_data_snapshots" ("school_id", "source", "dataset", "payload_hash");
CREATE INDEX "school_public_data_snapshots_latest_idx"
  ON "school_public_data_snapshots" ("school_id", "dataset", "fetched_at" DESC);

-- ───────────── 학급: 학년도·출처·재적 확인 ─────────────
ALTER TABLE "classes"
  ADD COLUMN "school_year"              INTEGER,
  ADD COLUMN "origin"                   "DataSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "enrolled_source"          "DataSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "enrolled_confirmed_at"    TIMESTAMPTZ,
  ADD COLUMN "enrolled_confirmed_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL;
-- 기존 학급은 만든 해(한국 시간)를 학년도로, 재적은 이미 입력된 값이므로 확인된 것으로 표시
UPDATE "classes" SET "school_year" = EXTRACT(YEAR FROM ("created_at" AT TIME ZONE 'Asia/Seoul'))::INTEGER WHERE "school_year" IS NULL;
UPDATE "classes" SET "enrolled_confirmed_at" = "updated_at" WHERE "enrolled_confirmed_at" IS NULL;
ALTER TABLE "classes" ALTER COLUMN "school_year" SET NOT NULL;
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_year_range" CHECK ("school_year" BETWEEN 2000 AND 2100);
-- 학교알리미는 학년 합계만 주므로, 학급 구조만 먼저 만들고 재적은 관리자가 확인할 때까지 비워 둘 수 있게 합니다.
ALTER TABLE "classes" ALTER COLUMN "enrolled_count" DROP NOT NULL;
ALTER TABLE "classes" ADD CONSTRAINT "classes_confirmed_has_count"
  CHECK ("enrolled_confirmed_at" IS NULL OR "enrolled_count" IS NOT NULL);
-- 학년도별 학급 구성: UNIQUE 키에 학년도를 추가
DROP INDEX "classes_school_grade_class_key";
CREATE UNIQUE INDEX "classes_school_year_grade_class_key" ON "classes" ("school_id", "school_year", "grade", "class_no");

-- ───────────── 학급 보고: 재적 미확인 학급 대비 ─────────────
-- 재적이 확인되지 않은 학급은 발령 시점 스냅숏이 비어 있을 수 있고, 이때 보고자가 재적을 입력합니다.
ALTER TABLE "evacuation_reports" ALTER COLUMN "enrolled_snapshot" DROP NOT NULL;
