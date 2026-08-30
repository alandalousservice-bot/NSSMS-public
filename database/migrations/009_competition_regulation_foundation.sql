-- NSSMS-ARCH-006: regulation/programme foundation.
-- Additive migration. No future competition-domain tables are referenced here.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE competition_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ACTIVE','RETIRED','ARCHIVED')),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT competition_programmes_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT competition_programmes_season_code_uk UNIQUE (season_id, code)
);

CREATE INDEX competition_programmes_season_status_idx ON competition_programmes (season_id, status);

CREATE TABLE regulation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no text NOT NULL,
  parent_id uuid REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  programme_id uuid REFERENCES competition_programmes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  season_id uuid REFERENCES seasons(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scope_kind text NOT NULL DEFAULT 'GLOBAL' CHECK (scope_kind IN ('GLOBAL','SEASON','PROGRAMME')),
  scope_key text NOT NULL DEFAULT 'GLOBAL',
  effective_period daterange NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ACTIVE','RETIRED')),
  source_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT regulation_versions_period_ck CHECK (NOT isempty(effective_period)),
  CONSTRAINT regulation_versions_scope_ck CHECK (
    (scope_kind = 'GLOBAL' AND programme_id IS NULL AND season_id IS NULL AND scope_key = 'GLOBAL') OR
    (scope_kind = 'SEASON' AND programme_id IS NULL AND season_id IS NOT NULL AND scope_key = 'SEASON:' || season_id::text) OR
    (scope_kind = 'PROGRAMME' AND programme_id IS NOT NULL AND scope_key = 'PROGRAMME:' || programme_id::text)
  ),
  CONSTRAINT regulation_versions_identity_uk UNIQUE (scope_key, version_no)
);

CREATE INDEX regulation_versions_scope_status_idx ON regulation_versions (scope_key, status);
CREATE INDEX regulation_versions_period_gist_idx ON regulation_versions USING gist (effective_period);

CREATE OR REPLACE FUNCTION nssms_set_regulation_scope_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.programme_id IS NOT NULL THEN
    NEW.scope_kind := 'PROGRAMME';
    NEW.scope_key := 'PROGRAMME:' || NEW.programme_id::text;
  ELSIF NEW.season_id IS NOT NULL THEN
    NEW.scope_kind := 'SEASON';
    NEW.scope_key := 'SEASON:' || NEW.season_id::text;
  ELSE
    NEW.scope_kind := 'GLOBAL';
    NEW.scope_key := 'GLOBAL';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_regulation_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.scope_key, 0));
    IF EXISTS (
      SELECT 1 FROM regulation_versions rv
      WHERE rv.scope_key = NEW.scope_key
        AND rv.status = 'ACTIVE'
        AND rv.effective_period && NEW.effective_period
        AND rv.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'active regulation effective period overlaps for scope %', NEW.scope_key
        USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_regulation_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'published regulation versions are immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('APPROVED','ACTIVE','RETIRED') THEN
    RAISE EXCEPTION 'published regulation versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER regulation_versions_a_scope_key_trg
  BEFORE INSERT OR UPDATE OF programme_id, season_id ON regulation_versions
  FOR EACH ROW EXECUTE FUNCTION nssms_set_regulation_scope_key();
CREATE TRIGGER regulation_versions_overlap_trg
  BEFORE INSERT OR UPDATE OF status, effective_period, programme_id, season_id ON regulation_versions
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_regulation_overlap();
CREATE TRIGGER regulation_versions_immutable_trg
  BEFORE UPDATE OR DELETE ON regulation_versions
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_version();
CREATE TRIGGER competition_programmes_updated_at
  BEFORE UPDATE ON competition_programmes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER regulation_versions_updated_at
  BEFORE UPDATE ON regulation_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE regulation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  rule_key text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('TEXT','NUMERIC','DATE','BOOLEAN','JSON')),
  value_text text,
  value_numeric numeric,
  value_date date,
  value_bool boolean,
  value_jsonb jsonb,
  unit text,
  precedence smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulation_rules_value_one_ck CHECK (num_nonnulls(value_text, value_numeric, value_date, value_bool, value_jsonb) = 1),
  CONSTRAINT regulation_rules_type_value_ck CHECK (
    (value_type = 'TEXT' AND value_text IS NOT NULL) OR
    (value_type = 'NUMERIC' AND value_numeric IS NOT NULL) OR
    (value_type = 'DATE' AND value_date IS NOT NULL) OR
    (value_type = 'BOOLEAN' AND value_bool IS NOT NULL) OR
    (value_type = 'JSON' AND value_jsonb IS NOT NULL)
  ),
  CONSTRAINT regulation_rules_version_key_uk UNIQUE (regulation_version_id, rule_key)
);

CREATE INDEX regulation_rules_key_version_idx ON regulation_rules (rule_key, regulation_version_id);

CREATE TABLE regulation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title text NOT NULL,
  issuer text NOT NULL,
  document_identifier text,
  issued_on date,
  page_section text,
  sha256 char(64),
  archive_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulation_sources_sha256_ck CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-fA-F]{64}$')
);

CREATE UNIQUE INDEX regulation_sources_version_sha256_uk
  ON regulation_sources (regulation_version_id, sha256)
  WHERE sha256 IS NOT NULL;
CREATE INDEX regulation_sources_issuer_date_idx ON regulation_sources (issuer, issued_on);

CREATE OR REPLACE FUNCTION nssms_protect_regulation_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM regulation_versions WHERE id = COALESCE(NEW.regulation_version_id, OLD.regulation_version_id);
  IF TG_OP = 'DELETE' OR parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
    RAISE EXCEPTION 'rules and sources of published regulation versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER regulation_rules_immutable_trg
  BEFORE UPDATE OR DELETE ON regulation_rules FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_child();
CREATE TRIGGER regulation_sources_immutable_trg
  BEFORE UPDATE OR DELETE ON regulation_sources FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_child();
CREATE TRIGGER regulation_rules_updated_at
  BEFORE UPDATE ON regulation_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER regulation_sources_updated_at
  BEFORE UPDATE ON regulation_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();
