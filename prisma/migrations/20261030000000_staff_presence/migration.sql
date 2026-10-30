-- 2026-10-30 Beta PILOT 2 Phase 2: 교직원 앱 내 알림·소재 보고
-- 비파괴 마이그레이션: 새 enum 3개·새 테이블 3개·색인·제약·트리거만 추가합니다. 기존 테이블·데이터 변경 없음.
-- 정책
-- - 알림(staff_alerts): 실제 재난·모의훈련 모두. created_at(생성)은 전달을 뜻하지 않고, read_at 은 본인이 앱에서 확인한 시각.
-- - 소재(staff_presences): **실제 재난(mode='real')·진행 중 사건에만** — 모의훈련에는 행 자체가 생기지 않도록 트리거가 거부.
-- - 교외는 위치를 저장하지 않음(CHECK). GPS·주소 없음. 감사 기록에 위치 내용을 넣지 않음(애플리케이션).
-- - 이력(staff_presence_history): 수정 금지 트리거. 삭제는 막지 않음 — 보관 기간이 확정되면 승인된 절차로 사건 단위 정리.

CREATE TYPE "PresenceLocation" AS ENUM ('on_campus', 'off_campus');
CREATE TYPE "PresenceAvailability" AS ENUM ('available', 'unavailable', 'unsure');
CREATE TYPE "PresencePlace" AS ENUM ('classroom', 'staff_room', 'nurse_room', 'cafeteria', 'gym', 'playground', 'hallway', 'stairs', 'special_room', 'other');

CREATE TABLE "staff_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    CONSTRAINT "staff_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_alerts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_alerts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_alerts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_alerts_read_after_create" CHECK ("read_at" IS NULL OR "read_at" >= "created_at")
);
CREATE UNIQUE INDEX "staff_alerts_event_member_key" ON "staff_alerts" ("event_id", "membership_id");
CREATE INDEX "staff_alerts_member_read_idx" ON "staff_alerts" ("membership_id", "read_at");

CREATE TABLE "staff_presences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "location" "PresenceLocation" NOT NULL,
    "place_category" "PresencePlace",
    "place_detail" TEXT,
    "availability" "PresenceAvailability" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "first_responded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_presences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_presences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_presences_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_presences_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_presences_version_positive" CHECK ("version" >= 1),
    -- 교내: 장소 분류 필수, '기타'면 상세 필수, 상세 40자 이하(분류 표시와 합쳐 50자 이내) / 교외: 장소 저장 안 함
    CONSTRAINT "staff_presences_place_rule" CHECK (
      ("location" = 'on_campus' AND "place_category" IS NOT NULL
        AND ("place_detail" IS NULL OR char_length("place_detail") BETWEEN 1 AND 40)
        AND ("place_category" <> 'other' OR "place_detail" IS NOT NULL))
      OR ("location" = 'off_campus' AND "place_category" IS NULL AND "place_detail" IS NULL)
    )
);
CREATE UNIQUE INDEX "staff_presences_event_member_key" ON "staff_presences" ("event_id", "membership_id");
CREATE INDEX "staff_presences_school_event_idx" ON "staff_presences" ("school_id", "event_id");

CREATE TABLE "staff_presence_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "presence_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "location" "PresenceLocation" NOT NULL,
    "place_category" "PresencePlace",
    "place_detail" TEXT,
    "availability" "PresenceAvailability" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_presence_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_presence_history_presence_id_fkey" FOREIGN KEY ("presence_id") REFERENCES "staff_presences"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "staff_presence_history_place_rule" CHECK (
      ("location" = 'on_campus' AND "place_category" IS NOT NULL AND ("place_detail" IS NULL OR char_length("place_detail") BETWEEN 1 AND 40))
      OR ("location" = 'off_campus' AND "place_category" IS NULL AND "place_detail" IS NULL)
    )
);
CREATE UNIQUE INDEX "staff_presence_history_idempotency_key" ON "staff_presence_history" ("idempotency_key");
CREATE UNIQUE INDEX "staff_presence_history_presence_version_key" ON "staff_presence_history" ("presence_id", "version");

-- 소재는 실제 재난·진행 중 사건·같은 학교 소속에만(모의훈련·종료 후·다른 학교 행 생성·수정 거부). 애플리케이션 검사와 별개의 최종 방어선
CREATE FUNCTION "staff_presences_guard"() RETURNS trigger AS $$
DECLARE
  ev RECORD;
  member_school UUID;
BEGIN
  SELECT "school_id", "mode", "status" INTO ev FROM "disaster_events" WHERE "id" = NEW."event_id";
  IF ev."mode" <> 'real' THEN
    RAISE EXCEPTION 'staff_presences: 모의훈련에는 교직원 소재를 저장하지 않습니다';
  END IF;
  IF ev."status" <> 'active' THEN
    RAISE EXCEPTION 'staff_presences: 종료된 상황의 소재는 저장·수정할 수 없습니다';
  END IF;
  SELECT "school_id" INTO member_school FROM "school_memberships" WHERE "id" = NEW."membership_id";
  IF ev."school_id" <> NEW."school_id" OR member_school <> NEW."school_id" THEN
    RAISE EXCEPTION 'staff_presences: 학교가 일치하지 않습니다';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."event_id" <> OLD."event_id" OR NEW."membership_id" <> OLD."membership_id" OR NEW."school_id" <> OLD."school_id") THEN
    RAISE EXCEPTION 'staff_presences: 사건·교직원은 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "staff_presences_guard"
  BEFORE INSERT OR UPDATE ON "staff_presences"
  FOR EACH ROW EXECUTE FUNCTION "staff_presences_guard"();

-- 알림은 사건과 같은 학교 소속에게만
CREATE FUNCTION "staff_alerts_guard"() RETURNS trigger AS $$
BEGIN
  IF (SELECT "school_id" FROM "disaster_events" WHERE "id" = NEW."event_id") <> NEW."school_id"
     OR (SELECT "school_id" FROM "school_memberships" WHERE "id" = NEW."membership_id") <> NEW."school_id" THEN
    RAISE EXCEPTION 'staff_alerts: 학교가 일치하지 않습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "staff_alerts_guard"
  BEFORE INSERT ON "staff_alerts"
  FOR EACH ROW EXECUTE FUNCTION "staff_alerts_guard"();

CREATE FUNCTION "staff_presence_history_block_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'staff_presence_history는 수정할 수 없습니다';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "staff_presence_history_no_update"
  BEFORE UPDATE ON "staff_presence_history"
  FOR EACH ROW EXECUTE FUNCTION "staff_presence_history_block_update"();
