-- STEP 3-D 학교 직책·업무 권한(겸임) + 비상대피훈련일지
-- 비파괴 마이그레이션: 새 열거형 3개, 새 테이블 3개, 새 함수·트리거만 추가합니다.
-- 기존 테이블·데이터 변경 없음, DROP·ALTER TABLE 없음. 기존 테이블에는 트리거를 달지 않습니다.
-- 기존 school_memberships.role(admin/homeroom/staff)은 그대로 두고, 직책·업무는 별도 행으로 겸임을 표현합니다.

-- ───────────── 직책·업무(겸임 가능) ─────────────
-- principal(교장)·vice_principal(교감) = 학교 직책: 플랫폼 운영자 확인(granted_via='platform_operator')으로만 등록
-- safety_officer(안전업무 담당)·app_operator(앱 운영담당) = 학교 업무: 앱 운영담당(또는 기존 관리자)이 지정 가능
CREATE TYPE "StaffDuty" AS ENUM ('principal', 'vice_principal', 'safety_officer', 'app_operator');
CREATE TYPE "DutyGrantVia" AS ENUM ('school_app', 'platform_operator');

CREATE TABLE "member_duties" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "school_id"           UUID NOT NULL,
  "membership_id"       UUID NOT NULL,
  "duty"                "StaffDuty" NOT NULL,
  "is_acting"           BOOLEAN NOT NULL DEFAULT false,   -- 직무대리(교장·교감)
  "granted_via"         "DutyGrantVia" NOT NULL,
  "granted_by_id"       UUID,                              -- 앱에서 지정한 교직원(플랫폼 운영자 등록은 NULL)
  "granted_by_label"    TEXT,                              -- 플랫폼 운영자 이름 등
  "verification_method" TEXT,                              -- 교장·교감: 확인 방법(공문 등) 필수
  "note"                TEXT,
  "started_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at"            TIMESTAMPTZ(6),
  "ended_by_id"         UUID,
  "ended_by_label"      TEXT,
  "end_reason"          TEXT,                              -- 전보·퇴직·휴직·업무 변경 등
  CONSTRAINT "member_duties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "member_duties_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "member_duties_membership_fkey" FOREIGN KEY ("membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "member_duties_granted_by_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "member_duties_ended_by_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- 교장·교감은 플랫폼 운영자 확인으로만, 확인 방법 필수
  CONSTRAINT "member_duties_position_verified" CHECK (
    "duty" NOT IN ('principal', 'vice_principal')
    OR ("granted_via" = 'platform_operator' AND length(trim(coalesce("verification_method", ''))) > 0)),
  CONSTRAINT "member_duties_acting_position" CHECK (NOT "is_acting" OR "duty" IN ('principal', 'vice_principal')),
  CONSTRAINT "member_duties_end_fields" CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL) AND ("end_reason" IS NULL OR length(trim("end_reason")) > 0)),
  CONSTRAINT "member_duties_lengths" CHECK (
    coalesce(length("note"), 0) <= 200 AND coalesce(length("end_reason"), 0) <= 200
    AND coalesce(length("verification_method"), 0) <= 100 AND coalesce(length("granted_by_label"), 0) <= 50 AND coalesce(length("ended_by_label"), 0) <= 50)
);
-- 같은 사람에게 같은 업무가 동시에 두 번 걸리지 않음
CREATE UNIQUE INDEX "member_duties_active_key" ON "member_duties" ("membership_id", "duty") WHERE "ended_at" IS NULL;
-- 교장은 학교당 1명(현재 서비스 기본 정책)
CREATE UNIQUE INDEX "member_duties_one_principal" ON "member_duties" ("school_id") WHERE "duty" = 'principal' AND "ended_at" IS NULL;
CREATE INDEX "member_duties_school_idx" ON "member_duties" ("school_id", "duty") WHERE "ended_at" IS NULL;

CREATE FUNCTION "member_duties_guard"() RETURNS trigger AS $$
DECLARE ms RECORD; vices INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'member_duties(직책·업무 기록)는 삭제할 수 없습니다. 종료로 처리하세요';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- 종료만 1회 허용(나머지 값 변경 금지)
    IF OLD."ended_at" IS NOT NULL
       OR (NEW."school_id", NEW."membership_id", NEW."duty", NEW."is_acting", NEW."granted_via", NEW."granted_by_id", NEW."granted_by_label",
           NEW."verification_method", NEW."note", NEW."started_at")
          IS DISTINCT FROM
          (OLD."school_id", OLD."membership_id", OLD."duty", OLD."is_acting", OLD."granted_via", OLD."granted_by_id", OLD."granted_by_label",
           OLD."verification_method", OLD."note", OLD."started_at") THEN
      RAISE EXCEPTION '직책·업무 기록은 종료만 할 수 있습니다';
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT: 같은 학교의 승인된 교직원에게만
  SELECT "school_id", "status" INTO ms FROM "school_memberships" WHERE "id" = NEW."membership_id";
  IF ms IS NULL OR ms."school_id" <> NEW."school_id" THEN
    RAISE EXCEPTION '같은 학교 교직원에게만 직책·업무를 지정할 수 있습니다';
  END IF;
  IF ms."status" <> 'approved' THEN
    RAISE EXCEPTION '가입이 승인된 교직원에게만 직책·업무를 지정할 수 있습니다';
  END IF;
  IF NEW."ended_at" IS NOT NULL THEN
    RAISE EXCEPTION '새 직책·업무는 진행 중으로 시작합니다';
  END IF;
  IF NEW."duty" = 'vice_principal' THEN
    PERFORM pg_advisory_xact_lock(hashtext('member_duties_vice:' || NEW."school_id"::text));
    SELECT count(*) INTO vices FROM "member_duties" WHERE "school_id" = NEW."school_id" AND "duty" = 'vice_principal' AND "ended_at" IS NULL;
    IF vices >= 2 THEN
      RAISE EXCEPTION '교감은 학교당 최대 2명까지 등록할 수 있습니다(현재 서비스 정책)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "member_duties_guarded" BEFORE INSERT OR UPDATE OR DELETE ON "member_duties"
  FOR EACH ROW EXECUTE FUNCTION "member_duties_guard"();

-- ───────────── 비상대피훈련일지 ─────────────
CREATE TYPE "DrillLogStatus" AS ENUM ('draft', 'completed');

CREATE TABLE "drill_logs" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "school_id"         UUID NOT NULL,
  "event_id"          UUID NOT NULL,
  "form_key"          TEXT NOT NULL DEFAULT 'evacuation_drill',   -- 서식 종류(향후 황사·미세먼지 일지 등)
  "form_version"      INTEGER NOT NULL DEFAULT 1,
  "status"            "DrillLogStatus" NOT NULL DEFAULT 'draft',
  "version"           INTEGER NOT NULL DEFAULT 1,                 -- 저장할 때마다 정확히 +1(동시 수정 방지)
  "auto_snapshot"     JSONB NOT NULL,                             -- 자동작성 당시 시스템 기록(원본 대피 보고는 바꾸지 않음)
  "auto_taken_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "manual"            JSONB NOT NULL,                             -- 담당자 입력값(참가 인원·역할·소요 시간·평가·반영사항 등)
  "created_by_id"     UUID,
  "updated_by_id"     UUID,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drill_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "drill_logs_event_key" UNIQUE ("event_id"),             -- 이벤트당 기본 훈련일지 1건
  CONSTRAINT "drill_logs_school_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drill_logs_event_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "drill_logs_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "drill_logs_updater_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "drill_logs_version_pos" CHECK ("version" >= 1),
  CONSTRAINT "drill_logs_json_objects" CHECK (jsonb_typeof("auto_snapshot") = 'object' AND jsonb_typeof("manual") = 'object'),
  CONSTRAINT "drill_logs_size" CHECK (octet_length("manual"::text) <= 40000 AND octet_length("auto_snapshot"::text) <= 400000)
);
CREATE INDEX "drill_logs_school_updated_idx" ON "drill_logs" ("school_id", "updated_at" DESC);

CREATE TABLE "drill_log_revisions" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "drill_log_id"   UUID NOT NULL,
  "version"        INTEGER NOT NULL,
  "status"         "DrillLogStatus" NOT NULL,
  "auto_snapshot"  JSONB NOT NULL,
  "manual"         JSONB NOT NULL,
  "changed_by_id"  UUID,
  "changed_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drill_log_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "drill_log_revisions_log_fkey" FOREIGN KEY ("drill_log_id") REFERENCES "drill_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drill_log_revisions_changer_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "drill_log_revisions_log_version_key" ON "drill_log_revisions" ("drill_log_id", "version");

-- 새 훈련일지: 같은 학교의 '종료된 모의훈련' 이벤트에만, 작성 중·판 1로 시작
CREATE FUNCTION "drill_logs_check_insert"() RETURNS trigger AS $$
DECLARE ev RECORD;
BEGIN
  SELECT "school_id", "mode", "status" INTO ev FROM "disaster_events" WHERE "id" = NEW."event_id";
  IF ev IS NULL OR ev."school_id" <> NEW."school_id" THEN
    RAISE EXCEPTION '같은 학교의 재난 대응 기록에만 훈련일지를 만들 수 있습니다';
  END IF;
  IF ev."mode" <> 'drill' THEN
    RAISE EXCEPTION '실제 재난 대응 기록에는 훈련일지를 만들 수 없습니다';
  END IF;
  IF ev."status" <> 'closed' THEN
    RAISE EXCEPTION '종료된 훈련에만 훈련일지를 만들 수 있습니다';
  END IF;
  IF NEW."status" <> 'draft' OR NEW."version" <> 1 THEN
    RAISE EXCEPTION '새 훈련일지는 작성 중(판 번호 1)으로 시작합니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "drill_logs_insert_guard" BEFORE INSERT ON "drill_logs"
  FOR EACH ROW EXECUTE FUNCTION "drill_logs_check_insert"();

-- 수정 규칙: 삭제 금지, 학교·이벤트·서식·작성자·작성 시각 변경 금지, 내용이 바뀌면 판 번호 정확히 +1
CREATE FUNCTION "drill_logs_check_update"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'drill_logs(훈련일지)는 삭제할 수 없습니다';
  END IF;
  IF (NEW."school_id", NEW."event_id", NEW."form_key", NEW."form_version", NEW."created_by_id", NEW."created_at")
     IS DISTINCT FROM (OLD."school_id", OLD."event_id", OLD."form_key", OLD."form_version", OLD."created_by_id", OLD."created_at") THEN
    RAISE EXCEPTION '훈련일지의 학교·이벤트·서식·작성자·작성 시각은 바꿀 수 없습니다';
  END IF;
  IF (NEW."status", NEW."auto_snapshot", NEW."manual") IS DISTINCT FROM (OLD."status", OLD."auto_snapshot", OLD."manual") THEN
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION '훈련일지 판 번호는 저장할 때마다 1씩 올라가야 합니다(현재 %, 요청 %)', OLD."version", NEW."version";
    END IF;
  ELSIF NEW."version" <> OLD."version" THEN
    RAISE EXCEPTION '내용 변경 없이 판 번호를 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "drill_logs_update_guard" BEFORE UPDATE OR DELETE ON "drill_logs"
  FOR EACH ROW EXECUTE FUNCTION "drill_logs_check_update"();

-- 수정 이력은 DB가 자동 기록(판마다 1행)
CREATE FUNCTION "drill_logs_write_revision"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."version" <> OLD."version" THEN
    INSERT INTO "drill_log_revisions" ("drill_log_id", "version", "status", "auto_snapshot", "manual", "changed_by_id")
    VALUES (NEW."id", NEW."version", NEW."status", NEW."auto_snapshot", NEW."manual",
            CASE WHEN TG_OP = 'INSERT' THEN NEW."created_by_id" ELSE NEW."updated_by_id" END);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "drill_logs_revision_log" AFTER INSERT OR UPDATE ON "drill_logs"
  FOR EACH ROW EXECUTE FUNCTION "drill_logs_write_revision"();

-- 수정 이력: 현재 판과 같은 내용만 추가 가능, 수정·삭제 불가
CREATE FUNCTION "drill_log_revisions_guard"() RETURNS trigger AS $$
DECLARE d RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'drill_log_revisions(훈련일지 수정 이력)는 수정하거나 삭제할 수 없습니다';
  END IF;
  SELECT "version", "status", "auto_snapshot", "manual" INTO d FROM "drill_logs" WHERE "id" = NEW."drill_log_id";
  IF d IS NULL OR (d."version", d."status", d."auto_snapshot", d."manual")
       IS DISTINCT FROM (NEW."version", NEW."status", NEW."auto_snapshot", NEW."manual") THEN
    RAISE EXCEPTION '수정 이력은 훈련일지의 현재 판과 같아야 합니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "drill_log_revisions_guarded" BEFORE INSERT OR UPDATE OR DELETE ON "drill_log_revisions"
  FOR EACH ROW EXECUTE FUNCTION "drill_log_revisions_guard"();
