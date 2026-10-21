-- STEP 3-C 재난안전 안내문 작성 지원(작성·수정·복사·선택적 처리 이력)
-- 비파괴 마이그레이션: 새 열거형 2개와 새 테이블 3개만 추가합니다. 기존 테이블·데이터 변경 없음, DROP 없음.
-- 실제 발송·승인·모의 발송·학부모 연락처 관련 테이블과 열은 만들지 않습니다.

CREATE TYPE "NoticeStatus" AS ENUM ('draft', 'completed', 'cancelled');
-- 처리 이력의 발송 채널은 '기록용 분류'일 뿐, 어떤 외부 서비스와도 연결되지 않습니다.
CREATE TYPE "NoticeChannelLabel" AS ENUM ('sms', 'school_app', 'kakao', 'other');

-- 학교가 작성한 안내문(공식 경보 원문과 별도 보관)
CREATE TABLE "school_notices" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "school_id"        UUID NOT NULL,
  "alert_id"         UUID NOT NULL,             -- 연결한 공식 경보(재송출 묶음이면 대표 경보)
  "example_key"      TEXT,                      -- 불러온 예시문 키(예: heatwave.parent.issued). 직접 작성이면 NULL
  "example_version"  INTEGER,
  "title"            TEXT NOT NULL,
  "body"             TEXT NOT NULL,
  "status"           "NoticeStatus" NOT NULL DEFAULT 'draft',
  "version"          INTEGER NOT NULL DEFAULT 1, -- 동시 수정 방지(저장할 때 이전 판 번호 확인)
  "created_by_id"    UUID,
  "updated_by_id"    UUID,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at"     TIMESTAMPTZ(6),
  "cancel_reason"    TEXT,
  CONSTRAINT "school_notices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_notices_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_notices_alert_fkey" FOREIGN KEY ("alert_id") REFERENCES "official_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_notices_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "school_notices_updater_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "school_notices_title_len" CHECK (length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "school_notices_body_len" CHECK (length("body") BETWEEN 1 AND 5000),
  CONSTRAINT "school_notices_version_pos" CHECK ("version" >= 1),
  CONSTRAINT "school_notices_example_pair" CHECK (("example_key" IS NULL) = ("example_version" IS NULL)),
  CONSTRAINT "school_notices_cancel_reason" CHECK ("status" <> 'cancelled' OR ("cancelled_at" IS NOT NULL AND length(trim(coalesce("cancel_reason", ''))) > 0))
);
CREATE INDEX "school_notices_school_alert_idx" ON "school_notices" ("school_id", "alert_id");
CREATE INDEX "school_notices_school_updated_idx" ON "school_notices" ("school_id", "updated_at" DESC);

-- 수정 이력(저장할 때마다 1행, 추가만 가능)
CREATE TABLE "school_notice_revisions" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "notice_id"     UUID NOT NULL,
  "version"       INTEGER NOT NULL,
  "title"         TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "status"        "NoticeStatus" NOT NULL,
  "example_key"   TEXT,
  "changed_by_id" UUID,
  "changed_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "school_notice_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_notice_revisions_notice_fkey" FOREIGN KEY ("notice_id") REFERENCES "school_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_notice_revisions_changer_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "school_notice_revisions_notice_version_key" ON "school_notice_revisions" ("notice_id", "version");

CREATE FUNCTION "school_notice_revisions_block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'school_notice_revisions(안내문 수정 이력)는 수정하거나 삭제할 수 없습니다';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "school_notice_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "school_notice_revisions"
  FOR EACH ROW EXECUTE FUNCTION "school_notice_revisions_block_change"();

-- 안내문은 삭제하지 않고 '취소'로만 처리
CREATE FUNCTION "school_notices_block_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'school_notices(안내문)는 삭제할 수 없습니다. 취소로 처리하세요';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "school_notices_no_delete"
  BEFORE DELETE ON "school_notices"
  FOR EACH ROW EXECUTE FUNCTION "school_notices_block_delete"();

-- 선택적 처리 이력: 교사가 직접 입력한 기록일 뿐 실제 발송·수신을 뜻하지 않음. 연락처 등 개인정보 열 없음
CREATE TABLE "notice_handling_records" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "notice_id"          UUID NOT NULL,
  "school_id"          UUID NOT NULL,
  "channel"            "NoticeChannelLabel",
  "channel_note"       TEXT,                      -- 기타 채널 이름 등
  "audience_category"  TEXT,                      -- 예: '1학년 학부모'(범주만, 개인 식별 정보 금지)
  "sent_by_teacher"    BOOLEAN NOT NULL DEFAULT false, -- 교사가 직접 '발송 완료'로 입력했는지
  "sent_at"            TIMESTAMPTZ(6),
  "memo"               TEXT,
  "recorded_by_id"     UUID,
  "recorded_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at"          TIMESTAMPTZ(6),
  "void_reason"        TEXT,
  CONSTRAINT "notice_handling_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notice_handling_records_notice_fkey" FOREIGN KEY ("notice_id") REFERENCES "school_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notice_handling_records_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notice_handling_records_recorder_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "notice_handling_records_lengths" CHECK (
    coalesce(length("channel_note"), 0) <= 50 AND coalesce(length("audience_category"), 0) <= 100 AND coalesce(length("memo"), 0) <= 500),
  CONSTRAINT "notice_handling_records_sent_at" CHECK ("sent_at" IS NULL OR "sent_by_teacher"),
  CONSTRAINT "notice_handling_records_void" CHECK ("voided_at" IS NULL OR length(trim(coalesce("void_reason", ''))) > 0)
);
CREATE INDEX "notice_handling_records_notice_idx" ON "notice_handling_records" ("notice_id", "recorded_at");

-- 처리 이력은 '무효 처리(voided_at, void_reason)'만 허용하고 나머지 수정·삭제는 막음
CREATE FUNCTION "notice_handling_records_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notice_handling_records(처리 이력)는 삭제할 수 없습니다. 무효 처리하세요';
  END IF;
  IF OLD.voided_at IS NOT NULL
     OR (NEW.notice_id, NEW.school_id, NEW.channel, NEW.channel_note, NEW.audience_category, NEW.sent_by_teacher, NEW.sent_at, NEW.memo, NEW.recorded_by_id, NEW.recorded_at)
        IS DISTINCT FROM
        (OLD.notice_id, OLD.school_id, OLD.channel, OLD.channel_note, OLD.audience_category, OLD.sent_by_teacher, OLD.sent_at, OLD.memo, OLD.recorded_by_id, OLD.recorded_at) THEN
    RAISE EXCEPTION 'notice_handling_records(처리 이력)는 무효 처리만 할 수 있습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notice_handling_records_guarded"
  BEFORE UPDATE OR DELETE ON "notice_handling_records"
  FOR EACH ROW EXECUTE FUNCTION "notice_handling_records_guard"();
