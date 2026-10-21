-- STEP 3-C 재난안전 안내문 작성 지원(작성·수정·복사·선택적 처리 이력)
-- 비파괴 마이그레이션: 새 열거형 2개, 새 테이블 3개, 새 함수·트리거만 추가합니다.
-- 기존 테이블·데이터 변경 없음, DROP 없음. 기존 테이블에는 트리거를 달지 않습니다.
-- 실제 발송·승인·모의 발송·학부모 연락처 관련 테이블과 열은 만들지 않습니다.
-- 2차(10:37 검토 반영): 같은 학교 대상 경보만 연결, 처리 이력-안내문 학교 일치, 취소 후 변경 금지,
--                       수정 이력을 DB가 자동 기록(판 번호 +1 강제), 핵심 연결 값 변경 금지
-- 최종(10:55 통합 지시 반영): 취소된 안내문으로 새 초안 만들기(재사용)
--   - 원본은 그대로 두고 새 ID·판 1·작성 중으로 새 행을 만듦(source_notice_id로 원본 연결)
--   - 원본은 같은 학교의 '취소된' 안내문만, 같은 원본으로 만든 '작성 중' 초안은 동시에 1건만(중복 요청 방지)
--   - 새 초안의 경보 연결도 ①과 같은 검사(같은 학교·대상·대표 경보)를 받음
--   - ALTER TABLE 없음: 새 제약은 모두 CREATE TABLE 안에 정의

CREATE TYPE "NoticeStatus" AS ENUM ('draft', 'completed', 'cancelled');
-- 처리 이력의 발송 채널은 '기록용 분류'일 뿐, 어떤 외부 서비스와도 연결되지 않습니다.
CREATE TYPE "NoticeChannelLabel" AS ENUM ('sms', 'school_app', 'kakao', 'other');

-- ───────────── 학교 안내문(공식 경보 원문과 별도 보관) ─────────────
CREATE TABLE "school_notices" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "school_id"        UUID NOT NULL,
  "alert_id"         UUID NOT NULL,             -- 연결한 공식 경보(재송출 묶음이면 대표 경보)
  "example_key"      TEXT,                      -- 불러온 예시문 키(예: heatwave.parent.issued). 직접 작성이면 NULL
  "example_version"  INTEGER,
  "title"            TEXT NOT NULL,
  "body"             TEXT NOT NULL,
  "status"           "NoticeStatus" NOT NULL DEFAULT 'draft',
  "version"          INTEGER NOT NULL DEFAULT 1, -- 저장할 때마다 정확히 +1(트리거 강제), 동시 수정 방지에 사용
  "created_by_id"    UUID,
  "updated_by_id"    UUID,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at"     TIMESTAMPTZ(6),
  "cancel_reason"    TEXT,
  "source_notice_id" UUID,                      -- 재사용: 이 초안을 만든 원본(취소된 안내문). 직접 작성·예시문이면 NULL
  CONSTRAINT "school_notices_pkey" PRIMARY KEY ("id"),
  -- ② 처리 이력·재사용 원본이 '같은 학교' 안내문만 가리키도록 하는 복합 외래키 대상
  CONSTRAINT "school_notices_id_school_key" UNIQUE ("id", "school_id"),
  -- 재사용 원본은 같은 학교 안내문만(다른 학교 안내문 ID로 재사용 차단). 원본 삭제·변경 불가
  CONSTRAINT "school_notices_source_fkey" FOREIGN KEY ("source_notice_id", "school_id")
    REFERENCES "school_notices"("id", "school_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "school_notices_source_not_self" CHECK ("source_notice_id" IS NULL OR "source_notice_id" <> "id"),
  -- ① 같은 학교의 경보 판정 행이 있어야만 연결 가능(다른 학교 경보·판정 없는 경보 차단)
  CONSTRAINT "school_notices_match_fkey" FOREIGN KEY ("school_id", "alert_id")
    REFERENCES "school_alert_matches"("school_id", "alert_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "school_notices_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_notices_alert_fkey" FOREIGN KEY ("alert_id") REFERENCES "official_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "school_notices_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "school_notices_updater_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "school_notices_title_len" CHECK (length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "school_notices_body_len" CHECK (length("body") BETWEEN 1 AND 5000),
  CONSTRAINT "school_notices_version_pos" CHECK ("version" >= 1),
  CONSTRAINT "school_notices_example_pair" CHECK (("example_key" IS NULL) = ("example_version" IS NULL)),
  CONSTRAINT "school_notices_cancel_fields" CHECK (
    ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)
    AND ("status" <> 'cancelled' OR length(trim(coalesce("cancel_reason", ''))) > 0))
);
-- 같은 원본으로 만든 '작성 중' 초안은 1건만(두 번 누르기·동시 요청 → 기존 초안을 돌려줌)
CREATE UNIQUE INDEX "school_notices_source_draft_key" ON "school_notices" ("source_notice_id")
  WHERE "source_notice_id" IS NOT NULL AND "status" = 'draft';
CREATE INDEX "school_notices_school_alert_idx" ON "school_notices" ("school_id", "alert_id");
CREATE INDEX "school_notices_school_updated_idx" ON "school_notices" ("school_id", "updated_at" DESC);

-- ───────────── 수정 이력(DB 트리거만 기록, 추가만 가능) ─────────────
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

-- ───────────── 선택적 처리 이력(교사 직접 입력, 실제 발송 아님, 개인정보 열 없음) ─────────────
CREATE TABLE "notice_handling_records" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "notice_id"          UUID NOT NULL,
  "school_id"          UUID NOT NULL,
  "channel"            "NoticeChannelLabel",
  "channel_note"       TEXT,
  "audience_category"  TEXT,
  "sent_by_teacher"    BOOLEAN NOT NULL DEFAULT false,
  "sent_at"            TIMESTAMPTZ(6),
  "memo"               TEXT,
  "recorded_by_id"     UUID,
  "recorded_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at"          TIMESTAMPTZ(6),
  "void_reason"        TEXT,
  CONSTRAINT "notice_handling_records_pkey" PRIMARY KEY ("id"),
  -- ② 안내문과 학교가 반드시 일치
  CONSTRAINT "notice_handling_records_notice_school_fkey" FOREIGN KEY ("notice_id", "school_id")
    REFERENCES "school_notices"("id", "school_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notice_handling_records_recorder_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "notice_handling_records_lengths" CHECK (
    coalesce(length("channel_note"), 0) <= 50 AND coalesce(length("audience_category"), 0) <= 100 AND coalesce(length("memo"), 0) <= 500),
  CONSTRAINT "notice_handling_records_sent_at" CHECK ("sent_at" IS NULL OR "sent_by_teacher"),
  CONSTRAINT "notice_handling_records_void" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL) AND ("void_reason" IS NULL OR length(trim("void_reason")) > 0))
);
CREATE INDEX "notice_handling_records_notice_idx" ON "notice_handling_records" ("notice_id", "recorded_at");

-- ───────────── 트리거 ─────────────
-- ① 새 안내문은 그 학교의 '대상' 경보, 재송출이면 대표 경보에만 연결(판정은 나중에 바뀔 수 있으므로 만들 때 검사)
CREATE FUNCTION "school_notices_check_insert"() RETURNS trigger AS $$
DECLARE m RECORD;
BEGIN
  SELECT "result", "duplicate_of_alert_id" INTO m FROM "school_alert_matches"
   WHERE "school_id" = NEW."school_id" AND "alert_id" = NEW."alert_id";
  IF m IS NULL OR m."result" <> 'target' THEN
    RAISE EXCEPTION '안내문은 소속 학교의 대상 경보에만 연결할 수 있습니다';
  END IF;
  IF m."duplicate_of_alert_id" IS NOT NULL THEN
    RAISE EXCEPTION '재송출 경보가 아닌 대표 경보에 연결하세요';
  END IF;
  IF NEW."status" <> 'draft' OR NEW."version" <> 1 THEN
    RAISE EXCEPTION '새 안내문은 작성 중(판 번호 1)으로 시작합니다';
  END IF;
  -- 재사용: 원본은 같은 학교의 취소된 안내문만(취소되지 않은 안내문은 그 안내문을 직접 고침)
  IF NEW."source_notice_id" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "school_notices" s
        WHERE s."id" = NEW."source_notice_id" AND s."school_id" = NEW."school_id" AND s."status" = 'cancelled') THEN
    RAISE EXCEPTION '새 초안의 원본은 같은 학교의 취소된 안내문이어야 합니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "school_notices_insert_guard" BEFORE INSERT ON "school_notices"
  FOR EACH ROW EXECUTE FUNCTION "school_notices_check_insert"();

-- ③④ 수정 규칙: 취소된 안내문은 어떤 변경도 불가, 학교·경보·작성자·작성 시각·재사용 원본 변경 불가,
--     내용(제목·본문·상태·예시)이 바뀌면 판 번호가 정확히 +1, 삭제 불가
CREATE FUNCTION "school_notices_check_update"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'school_notices(안내문)는 삭제할 수 없습니다. 취소로 처리하세요';
  END IF;
  IF OLD."status" = 'cancelled' THEN
    RAISE EXCEPTION '취소된 안내문은 수정하거나 되돌릴 수 없습니다';
  END IF;
  IF (NEW."school_id", NEW."alert_id", NEW."created_by_id", NEW."created_at", NEW."source_notice_id")
     IS DISTINCT FROM (OLD."school_id", OLD."alert_id", OLD."created_by_id", OLD."created_at", OLD."source_notice_id") THEN
    RAISE EXCEPTION '안내문의 학교·연결 경보·작성자·작성 시각·재사용 원본은 바꿀 수 없습니다';
  END IF;
  IF (NEW."title", NEW."body", NEW."status", NEW."example_key", NEW."example_version")
     IS DISTINCT FROM (OLD."title", OLD."body", OLD."status", OLD."example_key", OLD."example_version") THEN
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION '안내문 판 번호는 저장할 때마다 1씩 올라가야 합니다(현재 %, 요청 %)', OLD."version", NEW."version";
    END IF;
  ELSIF NEW."version" <> OLD."version" THEN
    RAISE EXCEPTION '내용 변경 없이 판 번호를 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "school_notices_update_guard" BEFORE UPDATE OR DELETE ON "school_notices"
  FOR EACH ROW EXECUTE FUNCTION "school_notices_check_update"();

-- ④ 수정 이력은 DB가 자동 기록: 만들 때(판 1)와 내용이 바뀔 때마다 그 판의 내용을 그대로 1행 추가
CREATE FUNCTION "school_notices_write_revision"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."version" <> OLD."version" THEN
    INSERT INTO "school_notice_revisions" ("notice_id", "version", "title", "body", "status", "example_key", "changed_by_id")
    VALUES (NEW."id", NEW."version", NEW."title", NEW."body", NEW."status", NEW."example_key",
            CASE WHEN TG_OP = 'INSERT' THEN NEW."created_by_id" ELSE NEW."updated_by_id" END);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "school_notices_revision_log" AFTER INSERT OR UPDATE ON "school_notices"
  FOR EACH ROW EXECUTE FUNCTION "school_notices_write_revision"();

-- 수정 이력: 안내문의 현재 판과 같은 내용만 추가 가능(앱이 임의 이력을 넣을 수 없음), 수정·삭제 불가
CREATE FUNCTION "school_notice_revisions_guard"() RETURNS trigger AS $$
DECLARE n RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'school_notice_revisions(안내문 수정 이력)는 수정하거나 삭제할 수 없습니다';
  END IF;
  SELECT "version", "title", "body", "status", "example_key" INTO n FROM "school_notices" WHERE "id" = NEW."notice_id";
  IF n IS NULL OR (n."version", n."title", n."body", n."status", n."example_key")
       IS DISTINCT FROM (NEW."version", NEW."title", NEW."body", NEW."status", NEW."example_key") THEN
    RAISE EXCEPTION '수정 이력은 안내문의 현재 판과 같아야 합니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "school_notice_revisions_guarded" BEFORE INSERT OR UPDATE OR DELETE ON "school_notice_revisions"
  FOR EACH ROW EXECUTE FUNCTION "school_notice_revisions_guard"();

-- 처리 이력: 무효 처리(voided_at·void_reason)만 1회 허용, 그 외 수정·삭제 불가
CREATE FUNCTION "notice_handling_records_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notice_handling_records(처리 이력)는 삭제할 수 없습니다. 무효 처리하세요';
  END IF;
  IF OLD."voided_at" IS NOT NULL
     OR (NEW."notice_id", NEW."school_id", NEW."channel", NEW."channel_note", NEW."audience_category", NEW."sent_by_teacher", NEW."sent_at", NEW."memo", NEW."recorded_by_id", NEW."recorded_at")
        IS DISTINCT FROM
        (OLD."notice_id", OLD."school_id", OLD."channel", OLD."channel_note", OLD."audience_category", OLD."sent_by_teacher", OLD."sent_at", OLD."memo", OLD."recorded_by_id", OLD."recorded_at") THEN
    RAISE EXCEPTION 'notice_handling_records(처리 이력)는 무효 처리만 할 수 있습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notice_handling_records_guarded" BEFORE UPDATE OR DELETE ON "notice_handling_records"
  FOR EACH ROW EXECUTE FUNCTION "notice_handling_records_guard"();
