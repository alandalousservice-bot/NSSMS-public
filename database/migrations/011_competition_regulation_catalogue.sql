-- NSSMS-ARCH-007: regulation/catalogue foundation.
-- Additive migration. Competition stages and operational competition entities are intentionally out of scope.

CREATE TABLE sports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  sport_type text NOT NULL CHECK (sport_type IN ('INDIVIDUAL','TEAM','MIXED')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT sports_code_nonblank_ck CHECK (btrim(code) <> ''),
  CONSTRAINT sports_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT sports_code_uk UNIQUE (code)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES sports(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  format text NOT NULL CHECK (format IN ('INDIVIDUAL','TEAM','MIXED')),
  measurement_type text CHECK (measurement_type IN ('TIME','DISTANCE','WEIGHT','SCORE','POINTS','POSITION','OTHER')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT events_code_nonblank_ck CHECK (btrim(code) <> ''),
  CONSTRAINT events_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT events_sport_code_uk UNIQUE (sport_id, code)
);

CREATE INDEX events_sport_status_idx ON events (sport_id, status);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid REFERENCES competition_programmes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  gender_code text NOT NULL CHECK (gender_code IN ('MALE','FEMALE','MIXED','OPEN')),
  education_level text,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  programme_scope_key text GENERATED ALWAYS AS (COALESCE(programme_id::text, 'GLOBAL')) STORED,
  CONSTRAINT categories_code_nonblank_ck CHECK (btrim(code) <> ''),
  CONSTRAINT categories_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT categories_version_programme_code_uk UNIQUE (regulation_version_id, programme_scope_key, code)
);

CREATE INDEX categories_programme_status_idx ON categories (programme_id, status);
CREATE INDEX categories_regulation_version_idx ON categories (regulation_version_id);

CREATE TABLE event_rule_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage_level_code text,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  precedence smallint NOT NULL DEFAULT 0,
  effective_period daterange NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  category_scope_key text GENERATED ALWAYS AS (COALESCE(category_id::text, 'GLOBAL')) STORED,
  stage_level_scope_key text GENERATED ALWAYS AS (COALESCE(stage_level_code, 'GLOBAL')) STORED,
  CONSTRAINT event_rule_bindings_period_ck CHECK (NOT isempty(effective_period)),
  CONSTRAINT event_rule_bindings_stage_level_nonblank_ck CHECK (stage_level_code IS NULL OR btrim(stage_level_code) <> '')
);

ALTER TABLE event_rule_bindings
  ADD CONSTRAINT event_rule_bindings_conflict_excl
  EXCLUDE USING gist (
    event_id WITH =,
    category_scope_key WITH =,
    stage_level_scope_key WITH =,
    precedence WITH =,
    effective_period WITH &&
  );

CREATE INDEX event_rule_bindings_regulation_idx ON event_rule_bindings (regulation_version_id);

CREATE TABLE programme_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES competition_programmes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  effective_period daterange NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT programme_regions_code_nonblank_ck CHECK (btrim(code) <> ''),
  CONSTRAINT programme_regions_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT programme_regions_period_ck CHECK (NOT isempty(effective_period)),
  CONSTRAINT programme_regions_programme_version_code_uk UNIQUE (programme_id, regulation_version_id, code)
);

CREATE INDEX programme_regions_programme_status_idx ON programme_regions (programme_id, status);
CREATE INDEX programme_regions_period_gist_idx ON programme_regions USING gist (effective_period);

CREATE TABLE region_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_region_id uuid NOT NULL REFERENCES programme_regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  wilaya_id smallint NOT NULL REFERENCES wilayas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  effective_period daterange NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT region_memberships_period_ck CHECK (NOT isempty(effective_period)),
  CONSTRAINT region_memberships_region_wilaya_period_uk UNIQUE (programme_region_id, wilaya_id, effective_period)
);

CREATE INDEX region_memberships_region_idx ON region_memberships (programme_region_id);
CREATE INDEX region_memberships_wilaya_version_idx ON region_memberships (wilaya_id, regulation_version_id);
CREATE INDEX region_memberships_period_gist_idx ON region_memberships USING gist (effective_period);

CREATE OR REPLACE FUNCTION nssms_protect_sport_catalogue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ACTIVE','RETIRED','ARCHIVED') THEN
      RAISE EXCEPTION 'active or retired sports must be retired/archived, not deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('RETIRED','ARCHIVED') THEN
    RAISE EXCEPTION 'retired sports are immutable';
  END IF;
  IF OLD.status = 'ACTIVE' AND (
    NEW.code IS DISTINCT FROM OLD.code OR
    NEW.name IS DISTINCT FROM OLD.name OR
    NEW.sport_type IS DISTINCT FROM OLD.sport_type OR
    NEW.status NOT IN ('ACTIVE','RETIRED','ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'active sports must be retired/archived instead of redefined';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_event_catalogue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ACTIVE','RETIRED','ARCHIVED') THEN
      RAISE EXCEPTION 'active or retired events must be retired/archived, not deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('RETIRED','ARCHIVED') THEN
    RAISE EXCEPTION 'retired events are immutable';
  END IF;
  IF OLD.status = 'ACTIVE' AND (
    NEW.sport_id IS DISTINCT FROM OLD.sport_id OR
    NEW.code IS DISTINCT FROM OLD.code OR
    NEW.name IS DISTINCT FROM OLD.name OR
    NEW.format IS DISTINCT FROM OLD.format OR
    NEW.measurement_type IS DISTINCT FROM OLD.measurement_type OR
    NEW.status NOT IN ('ACTIVE','RETIRED','ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'active events must be retired/archived instead of redefined';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_regulation_catalogue_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent_status text;
  new_parent_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO new_parent_status FROM regulation_versions WHERE id = NEW.regulation_version_id;
    IF new_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'catalogue records of published regulation versions are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO old_parent_status FROM regulation_versions WHERE id = OLD.regulation_version_id;
    IF old_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'catalogue records of published regulation versions are immutable';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO old_parent_status FROM regulation_versions WHERE id = OLD.regulation_version_id;
  IF old_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
    RAISE EXCEPTION 'catalogue records of published regulation versions are immutable';
  END IF;
  IF NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id THEN
    SELECT status INTO new_parent_status FROM regulation_versions WHERE id = NEW.regulation_version_id;
    IF new_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'catalogue records of published regulation versions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_catalogue_regulation_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_programme_id uuid;
  category_version_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'programme_regions' THEN
    SELECT programme_id INTO version_programme_id FROM regulation_versions WHERE id = NEW.regulation_version_id;
    IF version_programme_id IS DISTINCT FROM NEW.programme_id THEN
      RAISE EXCEPTION 'programme region regulation version must belong to its programme';
    END IF;
  ELSIF TG_TABLE_NAME = 'categories' THEN
    IF NEW.programme_id IS NOT NULL THEN
      SELECT programme_id INTO version_programme_id FROM regulation_versions WHERE id = NEW.regulation_version_id;
      IF version_programme_id IS DISTINCT FROM NEW.programme_id THEN
        RAISE EXCEPTION 'category regulation version must belong to its programme';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'event_rule_bindings' AND NEW.category_id IS NOT NULL THEN
    SELECT regulation_version_id INTO category_version_id FROM categories WHERE id = NEW.category_id;
    IF category_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
      RAISE EXCEPTION 'event rule binding and category must use the same regulation version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_region_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  region_programme_id uuid;
  region_regulation_version_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT programme_id, regulation_version_id
    INTO region_programme_id, region_regulation_version_id
    FROM programme_regions WHERE id = NEW.programme_region_id;
  IF region_regulation_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
    RAISE EXCEPTION 'region membership must use the regulation version of its programme region';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.regulation_version_id::text || ':' || NEW.wilaya_id::text, 0));
  IF EXISTS (
    SELECT 1
      FROM region_memberships membership
      JOIN programme_regions region ON region.id = membership.programme_region_id
     WHERE membership.regulation_version_id = NEW.regulation_version_id
       AND membership.wilaya_id = NEW.wilaya_id
       AND region.programme_id = region_programme_id
       AND membership.effective_period && NEW.effective_period
       AND membership.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'wilaya has an overlapping programme-region membership for this regulation version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sports_catalogue_protection_trg
  BEFORE UPDATE OR DELETE ON sports
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_sport_catalogue();
CREATE TRIGGER sports_updated_at
  BEFORE UPDATE ON sports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER events_catalogue_protection_trg
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_event_catalogue();
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER categories_context_trg
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_catalogue_regulation_context();
CREATE TRIGGER categories_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_catalogue_child();
CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER event_rule_bindings_context_trg
  BEFORE INSERT OR UPDATE ON event_rule_bindings
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_catalogue_regulation_context();
CREATE TRIGGER event_rule_bindings_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON event_rule_bindings
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_catalogue_child();
CREATE TRIGGER event_rule_bindings_updated_at
  BEFORE UPDATE ON event_rule_bindings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER programme_regions_context_trg
  BEFORE INSERT OR UPDATE ON programme_regions
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_catalogue_regulation_context();
CREATE TRIGGER programme_regions_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON programme_regions
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_catalogue_child();
CREATE TRIGGER programme_regions_updated_at
  BEFORE UPDATE ON programme_regions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER region_memberships_context_trg
  BEFORE INSERT OR UPDATE OR DELETE ON region_memberships
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_region_membership();
CREATE TRIGGER region_memberships_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON region_memberships
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_catalogue_child();
CREATE TRIGGER region_memberships_updated_at
  BEFORE UPDATE ON region_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
