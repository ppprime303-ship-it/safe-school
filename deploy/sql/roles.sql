-- SAFE SCHOOL 국내 VPS: 실제 학교 시범운영 DB 계정·스키마(최초 1회, postgres 관리자 계정으로 실행)
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f deploy/sql/roles.sql
-- 비밀번호는 이 파일에 적지 않습니다. 실행 후 sudo -u postgres psql -c '\password ss_pilot' 로 따로 설정하세요.
--
-- 원칙
-- - 이 서버에는 시범운영 스키마(safeschool_prod_pilot) 하나만 만듭니다. 심사 스키마(safeschool_prod_judge)는 만들지 않습니다
--   (심사 환경은 Replit). 심사 도구는 이 스키마·계정에서 실행을 거부합니다.
-- - 스키마는 전용 계정 ss_pilot 이 소유합니다(마이그레이션 = 테이블 생성 권한 필요). 슈퍼유저·DB 생성·역할 생성 권한 없음.
-- - public 스키마에는 아무도 객체를 만들 수 없습니다(스키마 미지정 사고 방지).
-- - 데이터를 지우거나 기존 객체를 바꾸지 않습니다(이미 있으면 오류로 멈춤 — 다시 실행하지 말고 확인).

CREATE ROLE ss_pilot LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 15;

CREATE DATABASE safeschool OWNER postgres ENCODING 'UTF8' TEMPLATE template0;
\connect safeschool

REVOKE ALL ON DATABASE safeschool FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE safeschool TO ss_pilot;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA safeschool_prod_pilot AUTHORIZATION ss_pilot;
REVOKE ALL ON SCHEMA safeschool_prod_pilot FROM PUBLIC;

-- 기본 검색 경로를 자기 스키마로(주소에 schema 를 빠뜨려도 public 으로 가지 않게)
ALTER ROLE ss_pilot IN DATABASE safeschool SET search_path = safeschool_prod_pilot;

-- 확인: pilot_owner = ss_pilot, can_create_public = f, judge_schema_exists = f
SELECT (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'safeschool_prod_pilot') AS pilot_owner,
       has_schema_privilege('ss_pilot', 'public', 'CREATE') AS can_create_public,
       EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'safeschool_prod_judge') AS judge_schema_exists;
