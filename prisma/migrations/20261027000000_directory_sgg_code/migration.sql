-- STEP A 학교알리미 시군구 단위 학교 목록
-- 비파괴 마이그레이션: school_directory_entries 에 NULL 허용 열 1개와 색인 1개만 추가합니다.
-- 기존 행·제약 변경 없음, DROP 없음. 기존 행은 sgg_code 가 NULL(시도·전국 단위로 받은 목록)로 남습니다.
ALTER TABLE "school_directory_entries" ADD COLUMN "sgg_code" TEXT;

CREATE INDEX "school_directory_entries_kind_sgg_idx" ON "school_directory_entries" ("kind_code", "sgg_code");
