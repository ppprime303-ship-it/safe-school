-- STEP 3-B 공식 경보 수집·학교 지역 매칭·교직원 경보함
-- 비파괴 마이그레이션: 새 열거형·새 테이블만 추가합니다(기존 테이블·데이터 변경 없음, DROP 없음).

CREATE TYPE "AlertProvider" AS ENUM ('mock', 'mois_cbs');
CREATE TYPE "AlertKind" AS ENUM ('disaster_text', 'weather', 'air_quality', 'other');
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'advisory', 'warning', 'emergency');
CREATE TYPE "AlertMsgType" AS ENUM ('new', 'update', 'cancel');
CREATE TYPE "AlertMatchResult" AS ENUM ('target', 'non_target', 'undetermined');
CREATE TYPE "RegionSource" AS ENUM ('address_parsed', 'admin');
CREATE TYPE "CollectionStatus" AS ENUM ('success', 'failed', 'skipped');

-- 공식 경보 원문: 받은 그대로 보존(수정·삭제 불가). 학교 안내는 별도 테이블(STEP 3-B ⑤)에 둡니다.
CREATE TABLE "official_alerts" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider"        "AlertProvider" NOT NULL,
  "external_id"     TEXT NOT NULL,
  "is_mock"         BOOLEAN NOT NULL,
  "kind"            "AlertKind" NOT NULL,
  "severity"        "AlertSeverity" NOT NULL,
  "msg_type"        "AlertMsgType" NOT NULL DEFAULT 'new',
  "ref_external_id" TEXT,
  "issuer"          TEXT NOT NULL,
  "title"           TEXT,
  "body"            TEXT NOT NULL,
  "areas_raw"       TEXT NOT NULL,
  "areas"           JSONB NOT NULL,
  "issued_at"       TIMESTAMPTZ(6) NOT NULL,
  "expires_at"      TIMESTAMPTZ(6),
  "received_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "content_hash"    TEXT NOT NULL,
  "raw"             JSONB NOT NULL,
  CONSTRAINT "official_alerts_pkey" PRIMARY KEY ("id"),
  -- 모의 경보와 공식 경보가 섞이지 않도록: 모의 공급자만 is_mock = true
  CONSTRAINT "official_alerts_mock_flag" CHECK (("provider" = 'mock') = "is_mock"),
  CONSTRAINT "official_alerts_external_id_not_blank" CHECK (length(trim("external_id")) > 0),
  CONSTRAINT "official_alerts_body_not_blank" CHECK (length(trim("body")) > 0),
  CONSTRAINT "official_alerts_areas_array" CHECK (jsonb_typeof("areas") = 'array'),
  CONSTRAINT "official_alerts_ref_required" CHECK ("msg_type" = 'new' OR "ref_external_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "official_alerts_provider_external_key" ON "official_alerts" ("provider", "external_id");
CREATE INDEX "official_alerts_content_issued_idx" ON "official_alerts" ("content_hash", "issued_at");
CREATE INDEX "official_alerts_issued_idx" ON "official_alerts" ("issued_at" DESC);

CREATE FUNCTION "official_alerts_block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'official_alerts(공식 경보 원문)는 수정하거나 삭제할 수 없습니다';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "official_alerts_immutable"
  BEFORE UPDATE OR DELETE ON "official_alerts"
  FOR EACH ROW EXECUTE FUNCTION "official_alerts_block_change"();

-- 수집 실행 기록(성공·실패·과다 호출 방지로 건너뜀)
CREATE TABLE "alert_collection_runs" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider"             "AlertProvider" NOT NULL,
  "status"               "CollectionStatus" NOT NULL,
  "started_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"          TIMESTAMPTZ(6),
  "attempts"             INTEGER NOT NULL DEFAULT 1,
  "fetched_count"        INTEGER NOT NULL DEFAULT 0,
  "new_count"            INTEGER NOT NULL DEFAULT 0,
  "duplicate_count"      INTEGER NOT NULL DEFAULT 0,
  "matched_school_count" INTEGER NOT NULL DEFAULT 0,
  "cursor"               TEXT,
  "error_message"        TEXT,
  CONSTRAINT "alert_collection_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "alert_collection_runs_counts" CHECK ("fetched_count" >= 0 AND "new_count" >= 0 AND "duplicate_count" >= 0 AND "matched_school_count" >= 0 AND "attempts" >= 0),
  CONSTRAINT "alert_collection_runs_failed_message" CHECK ("status" <> 'failed' OR "error_message" IS NOT NULL)
);
CREATE INDEX "alert_collection_runs_provider_started_idx" ON "alert_collection_runs" ("provider", "started_at" DESC);

-- 학교 소재지(경보 지역 매칭용). 주소에서 자동 추출하거나 관리자가 확인·수정합니다.
CREATE TABLE "school_regions" (
  "school_id"       UUID NOT NULL,
  "sido"            TEXT NOT NULL,
  "sigungu"         TEXT,
  "source"          "RegionSource" NOT NULL,
  "confirmed_at"    TIMESTAMPTZ(6),
  "confirmed_by_id" UUID,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "school_regions_pkey" PRIMARY KEY ("school_id"),
  CONSTRAINT "school_regions_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_regions_confirmer_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "school_regions_admin_confirmed" CHECK ("source" <> 'admin' OR "confirmed_at" IS NOT NULL),
  CONSTRAINT "school_regions_sido_not_blank" CHECK (length(trim("sido")) > 0)
);

-- 학교별 매칭 결과: 대상 / 비대상 / 미판정(학교 지역 불명확)
CREATE TABLE "school_alert_matches" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "school_id"             UUID NOT NULL,
  "alert_id"              UUID NOT NULL,
  "result"                "AlertMatchResult" NOT NULL,
  "reason"                TEXT NOT NULL,
  "duplicate_of_alert_id" UUID,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "school_alert_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_alert_matches_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_alert_matches_alert_fkey" FOREIGN KEY ("alert_id") REFERENCES "official_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_alert_matches_dup_fkey" FOREIGN KEY ("duplicate_of_alert_id") REFERENCES "official_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_alert_matches_dup_only_target" CHECK ("duplicate_of_alert_id" IS NULL OR "result" = 'target'),
  CONSTRAINT "school_alert_matches_dup_not_self" CHECK ("duplicate_of_alert_id" IS NULL OR "duplicate_of_alert_id" <> "alert_id")
);
CREATE UNIQUE INDEX "school_alert_matches_school_alert_key" ON "school_alert_matches" ("school_id", "alert_id");
CREATE INDEX "school_alert_matches_school_created_idx" ON "school_alert_matches" ("school_id", "created_at" DESC);

-- 교직원별 읽음 상태
CREATE TABLE "alert_reads" (
  "user_id"  UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "read_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_reads_pkey" PRIMARY KEY ("user_id", "match_id"),
  CONSTRAINT "alert_reads_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "alert_reads_match_fkey" FOREIGN KEY ("match_id") REFERENCES "school_alert_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
