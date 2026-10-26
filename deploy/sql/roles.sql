-- SAFE SCHOOL 국내 VPS: 심사 환경과 실제 학교 시범운영 환경의 DB 계정·스키마 분리(최초 1회, postgres 관리자 계정으로 실행)
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f deploy/sql/roles.sql
-- 비밀번호는 이 파일에 적지 않습니다. 실행 후 psql 에서 \password ss_judge, \password ss_pilot 로 따로 설정하세요.
--
-- 원칙
-- - 한 DB(safeschool) 안에 스키마 2개. 각 스키마는 전용 계정이 소유하고, 다른 계정은 USAGE 권한이 없어 테이블을 볼 수 없습니다.
-- - public 스키마에는 아무도 객체를 만들 수 없습니다(스키마 미지정 사고 방지).
-- - 앱 계정은 슈퍼유저·DB 생성·역할 생성 권한이 없습니다.
-- - 이 파일은 데이터를 지우거나 기존 객체를 바꾸지 않습니다(이미 있으면 오류로 멈춤 — 다시 실행하지 말고 확인).

CREATE ROLE ss_judge LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 15;
CREATE ROLE ss_pilot LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 15;

CREATE DATABASE safeschool OWNER postgres;
\connect safeschool

REVOKE ALL ON DATABASE safeschool FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE safeschool TO ss_judge, ss_pilot;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA safeschool_prod_judge AUTHORIZATION ss_judge;
CREATE SCHEMA safeschool_prod_pilot AUTHORIZATION ss_pilot;
REVOKE ALL ON SCHEMA safeschool_prod_judge FROM PUBLIC;
REVOKE ALL ON SCHEMA safeschool_prod_pilot FROM PUBLIC;

-- 계정별 기본 검색 경로를 자기 스키마로(주소에 schema 를 빠뜨려도 public 으로 가지 않게)
ALTER ROLE ss_judge IN DATABASE safeschool SET search_path = safeschool_prod_judge;
ALTER ROLE ss_pilot IN DATABASE safeschool SET search_path = safeschool_prod_pilot;

-- 확인(둘 다 f 여야 함)
SELECT has_schema_privilege('ss_judge', 'safeschool_prod_pilot', 'USAGE') AS judge_can_see_pilot,
       has_schema_privilege('ss_pilot', 'safeschool_prod_judge', 'USAGE') AS pilot_can_see_judge;
