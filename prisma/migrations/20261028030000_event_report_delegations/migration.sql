-- 2026-10-28 v0.1 사건(훈련) 범위 대리 보고 지정
-- 비파괴 마이그레이션: 새 enum 1개·새 테이블 1개·색인만 추가합니다. 기존 테이블 변경 없음.
CREATE TYPE "DelegationReason" AS ENUM ('unreachable', 'unable', 'admin_decision');

CREATE TABLE "event_report_delegations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "delegate_membership_id" UUID NOT NULL,
    "original_membership_id" UUID,
    "reason" "DelegationReason" NOT NULL,
    "basis" TEXT,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_id" UUID,
    "end_reason" TEXT,
    CONSTRAINT "event_report_delegations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_report_delegations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "disaster_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_delegate_membership_id_fkey" FOREIGN KEY ("delegate_membership_id") REFERENCES "school_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_original_membership_id_fkey" FOREIGN KEY ("original_membership_id") REFERENCES "school_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "event_report_delegations_basis_len" CHECK ("basis" IS NULL OR char_length("basis") <= 200)
);

CREATE INDEX "event_report_delegations_event_delegate_idx" ON "event_report_delegations" ("event_id", "delegate_membership_id");
-- 사건·학급당 유효한 대리 지정은 1건
CREATE UNIQUE INDEX "event_report_delegations_one_active" ON "event_report_delegations" ("event_id", "class_id") WHERE "ended_at" IS NULL;
