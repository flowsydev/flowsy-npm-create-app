-- Create the Keycloak role if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '__KEYCLOAK_DB_USER__'
  ) THEN
    CREATE ROLE __KEYCLOAK_DB_USER__ LOGIN PASSWORD '__KEYCLOAK_DB_PASSWORD__';
  END IF;
END $$;

ALTER ROLE __KEYCLOAK_DB_USER__ WITH LOGIN PASSWORD '__KEYCLOAK_DB_PASSWORD__';

-- Create the database if it does not exist.
-- CREATE DATABASE cannot run inside a transaction block,
-- so we use \gexec to execute the dynamically generated statement.
-- format() with %I ensures the identifier is properly escaped.
SELECT format('CREATE DATABASE %I OWNER %I', '__KEYCLOAK_DB_NAME__', '__KEYCLOAK_DB_USER__')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = '__KEYCLOAK_DB_NAME__'
)\gexec

GRANT ALL PRIVILEGES ON DATABASE __KEYCLOAK_DB_NAME__ TO __KEYCLOAK_DB_USER__;

-- Connect to the Keycloak database to grant schema privileges.
-- In PostgreSQL 15+, the public schema is no longer writable by default.
-- Keycloak needs CREATE on public to manage its tables via Liquibase.
\connect __KEYCLOAK_DB_NAME__

GRANT ALL ON SCHEMA public TO __KEYCLOAK_DB_USER__;
ALTER SCHEMA public OWNER TO __KEYCLOAK_DB_USER__;
