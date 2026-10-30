-- 2026-11-01 Beta PILOT 2 Phase 4: 모의훈련 '비상대피훈련일지' + 실제 재난 '재난대피 상황보고서'(같은 표 drill_logs, 서식 키로 구분)
-- 비파괴 마이그레이션: 테이블·열·데이터 변경 없음. 바꾸는 것
--   1) 삽입 검사 함수(drill_logs_check_insert)를 새 규칙으로 교체(CREATE OR REPLACE — 기존 행에는 영향 없음)
--      - 서식 키와 사건 모드 일치: evacuation_drill ↔ drill, disaster_real ↔ real
--      - 진행 중 사건에도 '작성 중(draft)' 보고서를 만들 수 있음(최종 확정은 아래 2번)
--   2) 완료 검사 트리거 추가: 'completed' 는 사건 종료 후, 종료 시각 이후에 다시 불러온 자동 기록일 때만
--   3) 서식 키 CHECK(기존 행은 모두 evacuation_drill)
-- 이벤트당 1건(drill_logs_event_key UNIQUE), 삭제 금지·판 번호·수정 이력 트리거는 그대로입니다.

CREATE OR REPLACE FUNCTION "drill_logs_check_insert"() RETURNS trigger AS $$
DECLARE ev RECORD;
BEGIN
  SELECT "school_id", "mode", "status" INTO ev FROM "disaster_events" WHERE "id" = NEW."event_id";
  IF ev IS NULL OR ev."school_id" <> NEW."school_id" THEN
    RAISE EXCEPTION '같은 학교의 재난 대응 기록에만 보고서를 만들 수 있습니다';
  END IF;
  IF NOT ((NEW."form_key" = 'evacuation_drill' AND ev."mode" = 'drill') OR (NEW."form_key" = 'disaster_real' AND ev."mode" = 'real')) THEN
    RAISE EXCEPTION '보고서 서식이 사건 구분(모의훈련·실제 재난)과 맞지 않습니다';
  END IF;
  IF NEW."status" <> 'draft' OR NEW."version" <> 1 THEN
    RAISE EXCEPTION '새 보고서는 작성 중(판 번호 1)으로 시작합니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "drill_logs" ADD CONSTRAINT "drill_logs_form_key" CHECK ("form_key" IN ('evacuation_drill', 'disaster_real'));

-- 최종 확정(completed): 사건 종료 후 + 종료 시각 이후에 불러온 자동 기록(진행 중 기록으로 확정 금지)
CREATE FUNCTION "drill_logs_check_complete"() RETURNS trigger AS $$
DECLARE ev RECORD;
BEGIN
  IF NEW."status" = 'completed' AND (OLD."status" IS DISTINCT FROM 'completed' OR NEW."auto_snapshot" IS DISTINCT FROM OLD."auto_snapshot") THEN
    SELECT "status", "closed_at" INTO ev FROM "disaster_events" WHERE "id" = NEW."event_id";
    IF ev."status" <> 'closed' THEN
      RAISE EXCEPTION '사건이 종료된 뒤에 보고서를 완료할 수 있습니다';
    END IF;
    IF NEW."auto_taken_at" < ev."closed_at" THEN
      RAISE EXCEPTION '종료 뒤에 자동 기록을 다시 불러온 다음 완료하세요';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "drill_logs_complete_guard" BEFORE UPDATE ON "drill_logs"
  FOR EACH ROW EXECUTE FUNCTION "drill_logs_check_complete"();
