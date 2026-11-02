-- SAFE SCHOOL Beta PILOT 2 전용 DB·계정(최초 1회, 승인 후 postgres 관리자 계정으로 실행 — 아직 어디에도 실행하지 않았습니다)
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f deploy/sql/beta-roles.sql
-- 비밀번호는 이 파일에 적지 않습니다. 실행 후 sudo -u postgres psql -c '\password ss_beta' 로 따로 설정하세요.
--
-- 원칙
-- - 기존 Prototype의 DB(safeschool)·계정(ss_pilot)·스키마(safeschool_prod_pilot)는 만들거나 바꾸지 않습니다.
-- - ss_beta 는 safeschool_beta 에만 접속합니다. safeschool DB는 PUBLIC 접속 권한이 없어(roles.sql) ss_beta 로 접속되지 않습니다.
-- - 이미 있으면 오류로 멈춥니다. 다시 실행하지 말고 확인하세요. 데이터를 지우는 문장은 없습니다.

CREATE ROLE ss_beta LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 8;

CREATE DATABASE safeschool_beta OWNER postgres ENCODING 'UTF8' TEMPLATE template0;
\connect safeschool_beta

REVOKE ALL ON DATABASE safeschool_beta FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE safeschool_beta TO ss_beta;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA safeschool_beta AUTHORIZATION ss_beta;
REVOKE ALL ON SCHEMA safeschool_beta FROM PUBLIC;

ALTER ROLE ss_beta IN DATABASE safeschool_beta SET search_path = safeschool_beta;

-- 확인: beta_owner = ss_beta, can_create_public = f, can_connect_prototype_db = f(safeschool DB가 있을 때)
SELECT (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'safeschool_beta') AS beta_owner,
       has_schema_privilege('ss_beta', 'public', 'CREATE') AS can_create_public,
       (SELECT has_database_privilege('ss_beta', 'safeschool', 'CONNECT') FROM pg_database WHERE datname = 'safeschool') AS can_connect_prototype_db;
