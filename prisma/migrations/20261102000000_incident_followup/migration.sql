-- 2026-11-02 Beta PILOT 2: 종료된 '실제 재난'의 현장 제보 후속 조치 기록 허용(최소 예외)
-- 비파괴 마이그레이션: 테이블·열·데이터 변경 없음. 함수 2개만 교체합니다.
--   1) incident_reports_guard: 종료된 실제 재난은 처리 상태·최근 활동만 변경 가능(본문 보호는 그대로, 모의훈련은 그대로 금지)
--   2) incident_child_guard: 종료된 실제 재난은 상태 이력과 '조치' 후속 기록만 추가 가능(사진·다른 후속 정보는 그대로 금지)
-- 새 제보, 학급 보고, 교직원 소재, 사건의 발령·종료 기록 규칙은 바꾸지 않습니다.

CREATE FUNCTION "incident_event_is_closed_real"(p_event UUID, p_school UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM "disaster_events" WHERE "id" = p_event AND "school_id" = p_school AND "status" = 'closed' AND "mode" = 'real');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION "incident_reports_guard"() RETURNS trigger AS $$
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
  -- UPDATE: 본문은 그대로, 상태·최근 활동만. 종료된 사건은 실제 재난의 후속 조치만
  IF NEW."school_id" <> OLD."school_id" OR NEW."event_id" <> OLD."event_id" OR NEW."reporter_membership_id" <> OLD."reporter_membership_id"
     OR NEW."type" <> OLD."type" OR NEW."place_category" <> OLD."place_category" OR NEW."place_detail" IS DISTINCT FROM OLD."place_detail"
     OR NEW."description" <> OLD."description" OR NEW."idempotency_key" <> OLD."idempotency_key" OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'incident_reports: 제보 본문은 바꿀 수 없습니다(후속 정보로 추가)';
  END IF;
  IF NOT "incident_event_is_active"(OLD."event_id", OLD."school_id") AND NOT "incident_event_is_closed_real"(OLD."event_id", OLD."school_id") THEN
    RAISE EXCEPTION 'incident_reports: 종료된 사건의 제보는 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "incident_child_guard"() RETURNS trigger AS $$
DECLARE
  inc RECORD;
  member_id UUID;
BEGIN
  SELECT "school_id", "event_id" INTO inc FROM "incident_reports" WHERE "id" = NEW."incident_id";
  IF NOT "incident_event_is_active"(inc."event_id", inc."school_id") THEN
    IF NOT (
      "incident_event_is_closed_real"(inc."event_id", inc."school_id")
      AND (TG_TABLE_NAME = 'incident_status_history' OR (TG_TABLE_NAME = 'incident_updates' AND to_jsonb(NEW) ->> 'kind' = 'action'))
    ) THEN
      RAISE EXCEPTION '%: 종료된 사건에는 추가할 수 없습니다', TG_TABLE_NAME;
    END IF;
  END IF;
  -- 작성자 열 이름은 트리거 인자로(테이블마다 다름)
  member_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF (SELECT "school_id" FROM "school_memberships" WHERE "id" = member_id) <> inc."school_id" THEN
    RAISE EXCEPTION '%: 학교가 일치하지 않습니다', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
