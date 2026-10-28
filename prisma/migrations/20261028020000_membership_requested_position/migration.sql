-- 2026-10-28 v0.1 교직원 구분 신청(권한 아님)
-- 비파괴 마이그레이션: school_memberships 에 NULL 허용 열 1개만 추가합니다. 기존 행·제약 변경 없음.
ALTER TABLE "school_memberships" ADD COLUMN "requested_position" TEXT;
