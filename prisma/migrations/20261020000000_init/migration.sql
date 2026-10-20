-- SAFE SCHOOL 첫 마이그레이션 (STEP 1)
-- 이 파일은 데이터를 삭제하지 않습니다. 새 테이블만 만듭니다.
-- 스키마 이름을 적지 않으므로, DATABASE_URL의 schema(기본 public)에 만들어집니다.

-- ───────────── 열거형 ─────────────
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');
CREATE TYPE "IdentityProvider" AS ENUM ('password', 'epki');
CREATE TYPE "VerificationPurpose" AS ENUM ('signup', 'invite', 'password_reset');
CREATE TYPE "DeviceKind" AS ENUM ('personal', 'shared');
CREATE TYPE "MemberRole" AS ENUM ('admin', 'homeroom', 'staff');
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked');
CREATE TYPE "ApprovalMethod" AS ENUM ('roster', 'manual', 'bootstrap');
CREATE TYPE "AssignmentDuty" AS ENUM ('homeroom', 'assist', 'inspection');
CREATE TYPE "DisasterType" AS ENUM ('fire', 'earthquake', 'storm_flood', 'heatwave', 'fine_dust', 'gas_leak', 'intruder', 'other');
CREATE TYPE "EventMode" AS ENUM ('real', 'drill');
CREATE TYPE "EventStatus" AS ENUM ('active', 'closed');
CREATE TYPE "EnrolledChangeReason" AS ENUM ('transfer_out', 'transfer_in', 'other');

-- ───────────── 학교 ─────────────
CREATE TABLE "schools" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"           TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "neis_code"      TEXT,
  "edu_office_code" TEXT,
  "join_code_hash" TEXT,
  "is_demo"        BOOLEAN NOT NULL DEFAULT false,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "schools_slug_format" CHECK ("slug" ~ '^[a-z0-9-]{3,40}$')
);
CREATE UNIQUE INDEX "schools_slug_key" ON "schools" ("slug");
CREATE UNIQUE INDEX "schools_neis_code_key" ON "schools" ("neis_code");
CREATE UNIQUE INDEX "schools_join_code_hash_key" ON "schools" ("join_code_hash");

-- ───────────── 사람과 인증 ─────────────
CREATE TABLE "users" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"             TEXT NOT NULL,
  "display_name"      TEXT NOT NULL,
  "password_hash"     TEXT,
  "email_verified_at" TIMESTAMPTZ,
  "status"            "UserStatus" NOT NULL DEFAULT 'active',
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 이메일은 항상 소문자로 저장해 대소문자 중복 가입을 막습니다.
  CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"))
);
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");

-- 인증수단은 사람과 분리합니다(향후 EPKI 연결용). 인증서·개인키는 저장하지 않습니다.
CREATE TABLE "user_identities" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"          UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider"         "IdentityProvider" NOT NULL,
  "provider_subject" TEXT NOT NULL,
  "linked_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities" ("provider", "provider_subject");
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" ("user_id");

CREATE TABLE "email_verifications" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose"     "VerificationPurpose" NOT NULL,
  "code_hash"   TEXT NOT NULL,
  "expires_at"  TIMESTAMPTZ NOT NULL,
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "email_verifications_attempts_range" CHECK ("attempts" BETWEEN 0 AND 10)
);
CREATE INDEX "email_verifications_user_purpose_idx" ON "email_verifications" ("user_id", "purpose");

-- 세션: 개인/공용 기기 정책을 분리하고, 권한 회수 시 user_id로 한 번에 삭제합니다.
CREATE TABLE "sessions" (
  "id"               TEXT PRIMARY KEY,           -- 세션 토큰의 해시값(원문 토큰은 저장하지 않음)
  "user_id"          UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "active_school_id" UUID REFERENCES "schools"("id") ON DELETE SET NULL,
  "device_kind"      "DeviceKind" NOT NULL,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at"       TIMESTAMPTZ NOT NULL,       -- 절대 만료
  "idle_expires_at"  TIMESTAMPTZ,                -- 미사용 만료(공용 기기)
  "reauth_at"        TIMESTAMPTZ,                -- 관리자 중요 작업용 최근 재인증 시각
  "user_agent"       TEXT,
  "ip"               TEXT
);
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- ───────────── 소속·학급 ─────────────
CREATE TABLE "school_memberships" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"       UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "user_id"         UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role"            "MemberRole" NOT NULL,
  "status"          "MembershipStatus" NOT NULL DEFAULT 'pending',
  "approval_method" "ApprovalMethod",
  "approved_by_id"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at"     TIMESTAMPTZ,
  "revoked_at"      TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "memberships_approved_has_method"
    CHECK ("status" <> 'approved' OR ("approval_method" IS NOT NULL AND "approved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "school_memberships_school_user_key" ON "school_memberships" ("school_id", "user_id");
CREATE INDEX "school_memberships_school_status_idx" ON "school_memberships" ("school_id", "status");

CREATE TABLE "classes" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"      UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "grade"          INTEGER NOT NULL,
  "class_no"       INTEGER NOT NULL,
  "label"          TEXT NOT NULL,
  "enrolled_count" INTEGER NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "classes_grade_range" CHECK ("grade" BETWEEN 1 AND 6),
  CONSTRAINT "classes_class_no_range" CHECK ("class_no" BETWEEN 1 AND 30),
  CONSTRAINT "classes_enrolled_range" CHECK ("enrolled_count" BETWEEN 0 AND 60)
);
CREATE UNIQUE INDEX "classes_school_grade_class_key" ON "classes" ("school_id", "grade", "class_no");

CREATE TABLE "class_assignments" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "membership_id" UUID NOT NULL REFERENCES "school_memberships"("id") ON DELETE CASCADE,
  "class_id"      UUID NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "duty"          "AssignmentDuty" NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "class_assignments_member_class_duty_key" ON "class_assignments" ("membership_id", "class_id", "duty");
CREATE INDEX "class_assignments_class_id_idx" ON "class_assignments" ("class_id");

-- 관리자 일괄 초대(명단 붙여넣기). 초대받은 사람이 이메일 인증을 마치면 자동 승인됩니다.
CREATE TABLE "staff_invitations" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"     UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "email"         TEXT NOT NULL,
  "display_name"  TEXT NOT NULL,
  "role"          "MemberRole" NOT NULL,
  "token_hash"    TEXT NOT NULL,
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "accepted_at"   TIMESTAMPTZ,
  "revoked_at"    TIMESTAMPTZ,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "staff_invitations_email_lowercase" CHECK ("email" = lower("email"))
);
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations" ("token_hash");
CREATE UNIQUE INDEX "staff_invitations_school_email_key" ON "staff_invitations" ("school_id", "email");

CREATE TABLE "invitation_assignments" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invitation_id" UUID NOT NULL REFERENCES "staff_invitations"("id") ON DELETE CASCADE,
  "class_id"      UUID NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "duty"          "AssignmentDuty" NOT NULL
);
CREATE UNIQUE INDEX "invitation_assignments_inv_class_duty_key" ON "invitation_assignments" ("invitation_id", "class_id", "duty");

-- ───────────── 재난 대응 ─────────────
CREATE TABLE "disaster_events" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"     UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "primary_type"  "DisasterType" NOT NULL,
  "mode"          "EventMode" NOT NULL,
  "status"        "EventStatus" NOT NULL DEFAULT 'active',
  "location"      TEXT,
  "evac_place"    TEXT,
  "message"       TEXT,
  "started_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "closed_at"     TIMESTAMPTZ,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_by_id"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "drill_plan_id" UUID,                                      -- STEP 5에서 훈련계획과 연결
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "disaster_events_closed_consistency"
    CHECK (("status" = 'active' AND "closed_at" IS NULL) OR ("status" = 'closed' AND "closed_at" IS NOT NULL))
);
-- 한 학교에 진행 중인 상황은 1건만(중복 발령 방지). 복합재난은 유형 추가로 처리합니다.
CREATE UNIQUE INDEX "disaster_events_one_active_per_school"
  ON "disaster_events" ("school_id") WHERE "status" = 'active';
CREATE INDEX "disaster_events_school_started_idx" ON "disaster_events" ("school_id", "started_at" DESC);

-- 복합재난: 진행 중인 상황에 재난 유형을 추가합니다(최초 유형도 한 줄로 기록).
CREATE TABLE "disaster_event_types" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"    UUID NOT NULL REFERENCES "disaster_events"("id") ON DELETE CASCADE,
  "type"        "DisasterType" NOT NULL,
  "note"        TEXT,
  "added_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "added_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "disaster_event_types_event_type_key" ON "disaster_event_types" ("event_id", "type");

-- 학급 보고(최신 상태). 수정 이력은 evacuation_report_revisions에 모두 남깁니다.
CREATE TABLE "evacuation_reports" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"               UUID NOT NULL REFERENCES "disaster_events"("id") ON DELETE RESTRICT,
  "school_id"              UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "class_id"               UUID NOT NULL REFERENCES "classes"("id") ON DELETE RESTRICT,
  "enrolled_snapshot"      INTEGER NOT NULL,   -- 발령 시점 학급 설정값
  "enrolled_count"         INTEGER NOT NULL,   -- 보고 시점 재적(담당자가 사유와 함께 수정 가능)
  "enrolled_change_reason" "EnrolledChangeReason",
  "absent_known"           INTEGER NOT NULL DEFAULT 0, -- 사전 파악 부재(결석·조퇴·외부활동)
  "evacuated"              INTEGER NOT NULL,   -- 대피 확인
  "unconfirmed"            INTEGER NOT NULL,   -- 미확인(서버가 계산해 저장)
  "injured"                INTEGER NOT NULL DEFAULT 0, -- 부상자(대피 여부와 별도 관리)
  "note"                   TEXT,
  "version"                INTEGER NOT NULL DEFAULT 1,
  "reported_by_id"         UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "reported_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "evacuation_reports_non_negative" CHECK (
    "enrolled_snapshot" >= 0 AND "enrolled_count" >= 0 AND "absent_known" >= 0
    AND "evacuated" >= 0 AND "unconfirmed" >= 0 AND "injured" >= 0 AND "version" >= 1),
  CONSTRAINT "evacuation_reports_enrolled_max" CHECK ("enrolled_count" <= 60),
  -- 핵심 무결성: 대피 확인 + 사전 파악 부재 + 미확인 = 보고 재적
  CONSTRAINT "evacuation_reports_sum_matches" CHECK ("evacuated" + "absent_known" + "unconfirmed" = "enrolled_count"),
  -- 부상자는 대피 완료자가 아닐 수도 있으므로 재적 이하만 검사합니다.
  CONSTRAINT "evacuation_reports_injured_max" CHECK ("injured" <= "enrolled_count"),
  -- 재적을 바꿨다면 사유가 있어야 합니다.
  CONSTRAINT "evacuation_reports_enrolled_change_reason"
    CHECK ("enrolled_count" = "enrolled_snapshot" OR "enrolled_change_reason" IS NOT NULL)
);
CREATE UNIQUE INDEX "evacuation_reports_event_class_key" ON "evacuation_reports" ("event_id", "class_id");
CREATE INDEX "evacuation_reports_school_event_idx" ON "evacuation_reports" ("school_id", "event_id");

CREATE TABLE "evacuation_report_revisions" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "report_id"              UUID NOT NULL REFERENCES "evacuation_reports"("id") ON DELETE RESTRICT,
  "version"                INTEGER NOT NULL,
  "enrolled_count"         INTEGER NOT NULL,
  "enrolled_change_reason" "EnrolledChangeReason",
  "absent_known"           INTEGER NOT NULL,
  "evacuated"              INTEGER NOT NULL,
  "unconfirmed"            INTEGER NOT NULL,
  "injured"                INTEGER NOT NULL,
  "note"                   TEXT,
  "change_reason"          TEXT,               -- 관리자 대리 보고 사유 등
  "idempotency_key"        TEXT NOT NULL,      -- 같은 요청이 두 번 저장되지 않게 함
  "changed_by_id"          UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "changed_at"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "evacuation_report_revisions_idempotency_key" ON "evacuation_report_revisions" ("idempotency_key");
CREATE UNIQUE INDEX "evacuation_report_revisions_report_version_key" ON "evacuation_report_revisions" ("report_id", "version");

-- ───────────── 감사 로그(추가만 가능) ─────────────
CREATE TABLE "audit_logs" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"     UUID REFERENCES "schools"("id") ON DELETE RESTRICT,
  "actor_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "action"        TEXT NOT NULL,
  "target_type"   TEXT,
  "target_id"     TEXT,
  "before"        JSONB,
  "after"         JSONB,
  "ip"            TEXT,
  "at"            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "audit_logs_school_at_idx" ON "audit_logs" ("school_id", "at" DESC);

CREATE FUNCTION "audit_logs_block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs는 수정하거나 삭제할 수 없습니다';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_change"();
