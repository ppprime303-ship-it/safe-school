-- 2026-10-31 Beta PILOT 2 Phase 3: 현장 상황 공유(제보·후속 정보·처리 상태·비공개 사진)
-- 비파괴 마이그레이션: 새 enum 3개·새 테이블 4개·색인·제약·트리거만 추가합니다. 기존 테이블·데이터 변경 없음.
-- 정책
-- - 제보는 실제 재난·모의훈련 모두, **진행 중 사건·같은 학교 소속만**(트리거). 교직원 소재(staff_presences)와 무관.
-- - 제보 본문(사건·작성자·유형·장소·설명·생성 시각)은 바꿀 수 없음 — 바뀌는 것은 처리 상태·최근 활동 시각뿐(트리거).
-- - 후속 정보·상태 이력은 추가 전용(수정·삭제 금지). 사진 메타데이터 행은 삭제 표시만(행 삭제는 보관 정책 확정 후 승인 절차로).
-- - 감사 기록에 설명·후속 내용·사진을 복제하지 않음(애플리케이션).

CREATE TYPE "IncidentType" AS ENUM ('hazard', 'facility_damage', 'blocked_route', 'help_needed', 'other');
CREATE TYPE "IncidentStatus" AS ENUM ('received', 'checking', 'in_progress', 'resolved');
CREATE TYPE "IncidentUpdateKind" AS ENUM ('info', 'change', 'action');

CREATE TABLE "incident_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "reporter_membership_id" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "place_category" "PresencePlace" NOT NULL,
    "place_detail" TEXT,
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'received',
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "incident_reports_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_reports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_reports_reporter_membership_id_fkey" FOREIGN KEY ("reporter_membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_reports_place_detail_len" CHECK ("place_detail" IS NULL OR char_length("place_detail") BETWEEN 1 AND 40),
    CONSTRAINT "incident_reports_place_other" CHECK ("place_category" <> 'other' OR "place_detail" IS NOT NULL),
    CONSTRAINT "incident_reports_description_len" CHECK (char_length("description") BETWEEN 2 AND 300)
);
CREATE UNIQUE INDEX "incident_reports_idempotency_key" ON "incident_reports" ("idempotency_key");
CREATE INDEX "incident_reports_school_event_idx" ON "incident_reports" ("school_id", "event_id", "last_activity_at" DESC);

CREATE TABLE "incident_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "author_membership_id" UUID NOT NULL,
    "kind" "IncidentUpdateKind" NOT NULL,
    "note" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incident_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_updates_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_updates_note_len" CHECK (char_length("note") BETWEEN 2 AND 300)
);
CREATE UNIQUE INDEX "incident_updates_idempotency_key" ON "incident_updates" ("idempotency_key");
CREATE INDEX "incident_updates_incident_idx" ON "incident_updates" ("incident_id", "created_at");

CREATE TABLE "incident_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "from_status" "IncidentStatus" NOT NULL,
    "to_status" "IncidentStatus" NOT NULL,
    "changed_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_status_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "incident_status_history_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incident_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_status_history_changed_by_membership_id_fkey" FOREIGN KEY ("changed_by_membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_status_history_changed" CHECK ("from_status" <> "to_status")
);
CREATE INDEX "incident_status_history_incident_idx" ON "incident_status_history" ("incident_id", "created_at");

CREATE TABLE "incident_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "uploader_membership_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_membership_id" UUID,
    CONSTRAINT "incident_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "incident_attachments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incident_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_attachments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_attachments_uploader_membership_id_fkey" FOREIGN KEY ("uploader_membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incident_attachments_deleted_by_membership_id_fkey" FOREIGN KEY ("deleted_by_membership_id") REFERENCES "school_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incident_attachments_mime" CHECK ("mime_type" IN ('image/jpeg', 'image/png')),
    CONSTRAINT "incident_attachments_size" CHECK ("size_bytes" BETWEEN 1 AND 5242880),
    CONSTRAINT "incident_attachments_key_format" CHECK ("storage_key" ~ '^[0-9a-f]{32}\.(jpg|png)$')
);
CREATE UNIQUE INDEX "incident_attachments_storage_key" ON "incident_attachments" ("storage_key");
CREATE INDEX "incident_attachments_incident_idx" ON "incident_attachments" ("incident_id");

-- 사건이 진행 중이고 학교가 일치하는지(제보·후속·상태 변경·사진 공통)
CREATE FUNCTION "incident_event_is_active"(p_event UUID, p_school UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM "disaster_events" WHERE "id" = p_event AND "school_id" = p_school AND "status" = 'active');
$$ LANGUAGE sql STABLE;

CREATE FUNCTION "incident_reports_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT "incident_event_is_active"(NEW."event_id", NEW."school_id") THEN
      RAISE EXCEPTION 'incident_reports: 진행 중인 같은 학교 사건에만 제보할 수 있습니다';
    END IF;
    IF (SELECT "school_id" FROM "school_memberships" WHERE "id" = NEW."reporter_membership_id") <> NEW."school_id" THEN
      RAISE EXCEPTION 'incident_reports: 학교가 일치하지 않습니다';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'incident_reports: 제보는 삭제할 수 없습니다(보관 정책 확정 후 승인 절차로만)';
  END IF;
  -- UPDATE: 본문은 그대로, 상태·최근 활동만. 종료된 사건은 바꿀 수 없음
  IF NEW."school_id" <> OLD."school_id" OR NEW."event_id" <> OLD."event_id" OR NEW."reporter_membership_id" <> OLD."reporter_membership_id"
     OR NEW."type" <> OLD."type" OR NEW."place_category" <> OLD."place_category" OR NEW."place_detail" IS DISTINCT FROM OLD."place_detail"
     OR NEW."description" <> OLD."description" OR NEW."idempotency_key" <> OLD."idempotency_key" OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'incident_reports: 제보 본문은 바꿀 수 없습니다(후속 정보로 추가)';
  END IF;
  IF NOT "incident_event_is_active"(OLD."event_id", OLD."school_id") THEN
    RAISE EXCEPTION 'incident_reports: 종료된 사건의 제보는 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incident_reports_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "incident_reports"
  FOR EACH ROW EXECUTE FUNCTION "incident_reports_guard"();

-- 후속·상태 이력·사진: 진행 중 사건의 같은 학교 소속만 추가
CREATE FUNCTION "incident_child_guard"() RETURNS trigger AS $$
DECLARE
  inc RECORD;
  member_id UUID;
BEGIN
  SELECT "school_id", "event_id" INTO inc FROM "incident_reports" WHERE "id" = NEW."incident_id";
  IF NOT "incident_event_is_active"(inc."event_id", inc."school_id") THEN
    RAISE EXCEPTION '%: 종료된 사건에는 추가할 수 없습니다', TG_TABLE_NAME;
  END IF;
  -- 작성자 열 이름은 트리거 인자로(테이블마다 다름)
  member_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF (SELECT "school_id" FROM "school_memberships" WHERE "id" = member_id) <> inc."school_id" THEN
    RAISE EXCEPTION '%: 학교가 일치하지 않습니다', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incident_updates_guard" BEFORE INSERT ON "incident_updates" FOR EACH ROW EXECUTE FUNCTION "incident_child_guard"('author_membership_id');
CREATE TRIGGER "incident_status_history_guard" BEFORE INSERT ON "incident_status_history" FOR EACH ROW EXECUTE FUNCTION "incident_child_guard"('changed_by_membership_id');
CREATE TRIGGER "incident_attachments_guard" BEFORE INSERT ON "incident_attachments" FOR EACH ROW EXECUTE FUNCTION "incident_child_guard"('uploader_membership_id');

CREATE FUNCTION "incident_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '%: 수정하거나 삭제할 수 없습니다', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incident_updates_append_only" BEFORE UPDATE OR DELETE ON "incident_updates" FOR EACH ROW EXECUTE FUNCTION "incident_append_only"();
CREATE TRIGGER "incident_status_history_append_only" BEFORE UPDATE OR DELETE ON "incident_status_history" FOR EACH ROW EXECUTE FUNCTION "incident_append_only"();

-- 사진 행: 삭제 표시(deleted_at·deleted_by)만 바꿀 수 있음, 행 삭제 금지
CREATE FUNCTION "incident_attachments_guard_update"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'incident_attachments: 행은 삭제할 수 없습니다(삭제 표시만)';
  END IF;
  IF NEW."incident_id" <> OLD."incident_id" OR NEW."school_id" <> OLD."school_id" OR NEW."uploader_membership_id" <> OLD."uploader_membership_id"
     OR NEW."storage_key" <> OLD."storage_key" OR NEW."mime_type" <> OLD."mime_type" OR NEW."size_bytes" <> OLD."size_bytes"
     OR NEW."sha256" <> OLD."sha256" OR NEW."created_at" <> OLD."created_at" OR OLD."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'incident_attachments: 삭제 표시 외에는 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "incident_attachments_guard_update" BEFORE UPDATE OR DELETE ON "incident_attachments" FOR EACH ROW EXECUTE FUNCTION "incident_attachments_guard_update"();
