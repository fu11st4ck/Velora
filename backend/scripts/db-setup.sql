-- Local development only: roles and databases. Passwords are throwaway dev values.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velora_owner') THEN
    CREATE ROLE velora_owner LOGIN PASSWORD 'velora_owner_dev' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velora_app') THEN
    CREATE ROLE velora_app LOGIN PASSWORD 'velora_app_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
SELECT 'CREATE DATABASE velora_dev OWNER velora_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'velora_dev') \gexec
SELECT 'CREATE DATABASE velora_test OWNER velora_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'velora_test') \gexec
\c velora_dev
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\c velora_test
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
