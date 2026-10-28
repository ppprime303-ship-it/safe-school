-- STEP D 플랫폼 운영관리자 권한(학교 소속과 별개)
-- 비파괴 마이그레이션: 새 테이블 1개와 색인만 추가합니다. 기존 테이블 변경 없음.
-- 부여·회수는 서버 셸 CLI 로만 하며, 회수해도 행을 지우지 않습니다(revoked_at 기록).
CREATE TABLE "platform_operators" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" TEXT NOT NULL,
    "grant_reason" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,
    CONSTRAINT "platform_operators_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_operators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "platform_operators_reason_len" CHECK (char_length("grant_reason") BETWEEN 1 AND 200 AND char_length("granted_by") BETWEEN 1 AND 50)
);

CREATE INDEX "platform_operators_user_idx" ON "platform_operators" ("user_id");
-- 사용자당 유효한 부여는 1건
CREATE UNIQUE INDEX "platform_operators_one_active" ON "platform_operators" ("user_id") WHERE "revoked_at" IS NULL;
