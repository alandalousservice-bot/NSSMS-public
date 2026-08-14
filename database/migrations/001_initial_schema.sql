CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('ACTIVE','SUSPENDED','DISABLED');
CREATE TYPE record_status AS ENUM ('ACTIVE','INACTIVE','ARCHIVED');
CREATE TYPE season_status AS ENUM ('DRAFT','UNDER_REVIEW','APPROVED','ACTIVE','CLOSED','ARCHIVED');
CREATE TYPE competition_status AS ENUM ('DRAFT','REVIEW','APPROVED','REGISTRATION','ACTIVE','RESULTS','CLOSED','ARCHIVED');
CREATE TYPE license_status AS ENUM ('APPLICATION','VALIDATION','APPROVAL','ISSUED','ACTIVE','EXPIRED','SUSPENDED','ARCHIVED');

CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, code text UNIQUE, status record_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz);
CREATE TABLE educational_institutions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, code text, status record_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, UNIQUE (organization_id, code));
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE, email text UNIQUE, password_hash text, display_name text NOT NULL, status user_status NOT NULL DEFAULT 'ACTIVE', organization_id uuid REFERENCES organizations(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES roles(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, role_id));
CREATE TABLE role_permissions (role_id uuid NOT NULL REFERENCES roles(id), permission_id uuid NOT NULL REFERENCES permissions(id), PRIMARY KEY (role_id, permission_id));

CREATE TABLE participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES educational_institutions(id), given_name text, family_name text, date_of_birth date, status record_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz);
CREATE TABLE seasons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, status season_status NOT NULL DEFAULT 'DRAFT', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, CHECK (end_date >= start_date));
CREATE TABLE competitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), season_id uuid NOT NULL REFERENCES seasons(id), name text NOT NULL, status competition_status NOT NULL DEFAULT 'DRAFT', start_date date, end_date date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date));
CREATE TABLE sports_licenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_id uuid NOT NULL REFERENCES participants(id), status license_status NOT NULL DEFAULT 'APPLICATION', issued_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at > issued_at));
CREATE TABLE qr_verifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), license_id uuid NOT NULL UNIQUE REFERENCES sports_licenses(id), reference_hash char(64) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE TABLE results (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL REFERENCES competitions(id), participant_id uuid REFERENCES participants(id), result_data jsonb NOT NULL DEFAULT '{}'::jsonb, status record_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz);
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT now(), actor_user_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid, result_status text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, request_id text);

CREATE INDEX idx_institutions_org ON educational_institutions(organization_id);
CREATE INDEX idx_participants_institution ON participants(institution_id);
CREATE INDEX idx_competitions_season_status ON competitions(season_id, status);
CREATE INDEX idx_licenses_participant_status ON sports_licenses(participant_id, status);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit logs are append-only'; END; $$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

INSERT INTO permissions (key, description) VALUES
 ('season.view','View seasons'),('season.create','Create seasons'),('season.submit','Submit seasons'),('season.approve','Approve seasons'),('season.activate','Activate seasons'),('season.close','Close seasons'),('season.archive','Archive seasons'),
 ('competition.view','View competitions'),('competition.create','Create competitions'),('participant.manage','Manage participants'),('license.manage','Manage licenses'),('license.verify','Verify licenses'),('result.manage','Manage results'),('audit.view','View audit events')
ON CONFLICT (key) DO NOTHING;
INSERT INTO roles (name, description) VALUES ('SYSTEM_ADMINISTRATOR','System administration role'),('NATIONAL_ADMINISTRATOR','National administration role'),('PUBLIC_USER','Public verification access') ON CONFLICT (name) DO NOTHING;
