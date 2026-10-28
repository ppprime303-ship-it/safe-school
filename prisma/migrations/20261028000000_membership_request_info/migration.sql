-- 2026-10-28 실교직원 가입 신청 정보(권한 아님)
-- 비파괴 마이그레이션: school_memberships 에 신청 정보 열 3개만 추가합니다. 기존 행·제약 변경 없음, DROP 없음.
-- requested_duties 는 빈 배열 기본값(기존 행은 '신청 업무 없음'), 나머지는 NULL 허용.
ALTER TABLE "school_memberships" ADD COLUMN "requested_duties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "school_memberships" ADD COLUMN "requested_class" TEXT;
ALTER TABLE "school_memberships" ADD COLUMN "request_note" TEXT;
