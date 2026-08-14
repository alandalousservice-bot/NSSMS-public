-- NSSMS-ARCH-008: first operational competition layer.
-- Additive migration. Entries, teams, people, results, qualifications, rankings, awards, and APIs remain out of scope.

CREATE TABLE competition_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  parent_stage_id uuid REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  programme_id uuid NOT NULL REFERENCES competition_programmes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  programme_region_id uuid REFERENCES programme_regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage_level_code text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','RESULTS','CLOSED','ARCHIVED')),
  host_wilaya_id smallint REFERENCES wilayas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  host_daira_id integer REFERENCES dairas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  host_commune_id integer REFERENCES communes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  host_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT competition_stages_level_nonblank_ck CHECK (btrim(stage_level_code) <> ''),
  CONSTRAINT competition_stages_dates_ck CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT competition_stages_no_self_parent_ck CHECK (parent_stage_id IS NULL OR parent_stage_id <> id)
);

CREATE INDEX competition_stages_competition_parent_status_idx ON competition_stages (competition_id, parent_stage_id, status);
CREATE INDEX competition_stages_programme_regulation_idx ON competition_stages (programme_id, regulation_version_id);
CREATE INDEX competition_stages_geography_idx ON competition_stages (host_wilaya_id, host_daira_id, host_commune_id);

CREATE TABLE calendar_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_source_id uuid REFERENCES regulation_sources(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PUBLISHED','COMPLETED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT calendar_occurrences_registration_dates_ck CHECK (
    registration_close_at IS NULL OR registration_open_at IS NULL OR registration_close_at >= registration_open_at
  ),
  CONSTRAINT calendar_occurrences_event_dates_ck CHECK (end_at IS NULL OR start_at IS NULL OR end_at >= start_at),
  CONSTRAINT calendar_occurrences_registration_before_event_ck CHECK (
    registration_close_at IS NULL OR start_at IS NULL OR registration_close_at <= start_at
  ),
  CONSTRAINT calendar_occurrences_identity_uk UNIQUE NULLS NOT DISTINCT (stage_id, event_id, category_id, start_at)
);

CREATE INDEX calendar_occurrences_stage_dates_idx ON calendar_occurrences (stage_id, start_at, status);
CREATE INDEX calendar_occurrences_regulation_idx ON calendar_occurrences (regulation_version_id);

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  wilaya_id smallint REFERENCES wilayas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  daira_id integer REFERENCES dairas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  commune_id integer REFERENCES communes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  address text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  technical_attributes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT venues_code_nonblank_ck CHECK (btrim(code) <> ''),
  CONSTRAINT venues_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT venues_technical_attributes_object_ck CHECK (technical_attributes IS NULL OR jsonb_typeof(technical_attributes) = 'object'),
  CONSTRAINT venues_code_uk UNIQUE (code)
);

CREATE INDEX venues_geography_status_idx ON venues (wilaya_id, daira_id, commune_id, status);

CREATE TABLE occurrence_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_occurrence_id uuid NOT NULL REFERENCES calendar_occurrences(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  start_at timestamptz,
  end_at timestamptz,
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT occurrence_venues_dates_ck CHECK (end_at IS NULL OR start_at IS NULL OR end_at >= start_at),
  CONSTRAINT occurrence_venues_role_nonblank_ck CHECK (role IS NULL OR btrim(role) <> ''),
  CONSTRAINT occurrence_venues_assignment_uk UNIQUE NULLS NOT DISTINCT (calendar_occurrence_id, venue_id, start_at, end_at, role)
);

CREATE INDEX occurrence_venues_occurrence_idx ON occurrence_venues (calendar_occurrence_id);
CREATE INDEX occurrence_venues_venue_idx ON occurrence_venues (venue_id);

CREATE OR REPLACE FUNCTION nssms_validate_competition_geography(
  target_wilaya_id smallint,
  target_daira_id integer,
  target_commune_id integer
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  daira_wilaya_id smallint;
  commune_daira_id integer;
  commune_wilaya_id smallint;
BEGIN
  IF target_daira_id IS NOT NULL AND target_wilaya_id IS NOT NULL THEN
    SELECT wilaya_id INTO daira_wilaya_id FROM dairas WHERE id = target_daira_id;
    IF daira_wilaya_id IS DISTINCT FROM target_wilaya_id THEN
      RAISE EXCEPTION 'daira must belong to the supplied wilaya';
    END IF;
  END IF;
  IF target_commune_id IS NOT NULL THEN
    SELECT daira_id, wilaya_id INTO commune_daira_id, commune_wilaya_id FROM communes WHERE id = target_commune_id;
    IF target_daira_id IS NOT NULL AND commune_daira_id IS DISTINCT FROM target_daira_id THEN
      RAISE EXCEPTION 'commune must belong to the supplied daira';
    END IF;
    IF target_wilaya_id IS NOT NULL AND commune_wilaya_id IS DISTINCT FROM target_wilaya_id THEN
      RAISE EXCEPTION 'commune must belong to the supplied wilaya';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_competition_stage_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  competition_season_id uuid;
  programme_season_id uuid;
  version_programme_id uuid;
  parent_competition_id uuid;
  parent_programme_id uuid;
  region_programme_id uuid;
  region_version_id uuid;
BEGIN
  SELECT season_id INTO competition_season_id FROM competitions WHERE id = NEW.competition_id;
  SELECT season_id INTO programme_season_id FROM competition_programmes WHERE id = NEW.programme_id;
  IF competition_season_id IS DISTINCT FROM programme_season_id THEN
    RAISE EXCEPTION 'competition stage programme must belong to the competition season';
  END IF;
  SELECT programme_id INTO version_programme_id FROM regulation_versions WHERE id = NEW.regulation_version_id;
  IF version_programme_id IS DISTINCT FROM NEW.programme_id THEN
    RAISE EXCEPTION 'competition stage regulation version must belong to its programme';
  END IF;
  IF NEW.parent_stage_id IS NOT NULL THEN
    SELECT competition_id, programme_id INTO parent_competition_id, parent_programme_id FROM competition_stages WHERE id = NEW.parent_stage_id;
    IF parent_competition_id IS DISTINCT FROM NEW.competition_id OR parent_programme_id IS DISTINCT FROM NEW.programme_id THEN
      RAISE EXCEPTION 'parent stage must belong to the same competition and programme';
    END IF;
  END IF;
  IF NEW.programme_region_id IS NOT NULL THEN
    SELECT programme_id, regulation_version_id INTO region_programme_id, region_version_id FROM programme_regions WHERE id = NEW.programme_region_id;
    IF region_programme_id IS DISTINCT FROM NEW.programme_id OR region_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
      RAISE EXCEPTION 'programme region must match the stage programme and regulation version';
    END IF;
  END IF;
  PERFORM nssms_validate_competition_geography(NEW.host_wilaya_id, NEW.host_daira_id, NEW.host_commune_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_calendar_occurrence_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stage_version_id uuid;
  stage_start_date date;
  stage_end_date date;
  category_version_id uuid;
  source_version_id uuid;
BEGIN
  SELECT regulation_version_id, start_date, end_date INTO stage_version_id, stage_start_date, stage_end_date
    FROM competition_stages WHERE id = NEW.stage_id;
  IF stage_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
    RAISE EXCEPTION 'calendar occurrence must use the regulation version of its stage';
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    SELECT regulation_version_id INTO category_version_id FROM categories WHERE id = NEW.category_id;
    IF category_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
      RAISE EXCEPTION 'calendar occurrence category must use its regulation version';
    END IF;
  END IF;
  IF NEW.regulation_source_id IS NOT NULL THEN
    SELECT regulation_version_id INTO source_version_id FROM regulation_sources WHERE id = NEW.regulation_source_id;
    IF source_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
      RAISE EXCEPTION 'calendar occurrence source must belong to its regulation version';
    END IF;
  END IF;
  IF NEW.start_at IS NOT NULL AND stage_start_date IS NOT NULL AND NEW.start_at::date < stage_start_date THEN
    RAISE EXCEPTION 'calendar occurrence cannot start before its stage';
  END IF;
  IF NEW.end_at IS NOT NULL AND stage_end_date IS NOT NULL AND NEW.end_at::date > stage_end_date THEN
    RAISE EXCEPTION 'calendar occurrence cannot end after its stage';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_venue_geography() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM nssms_validate_competition_geography(NEW.wilaya_id, NEW.daira_id, NEW.commune_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_venue_catalogue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('ACTIVE','RETIRED','ARCHIVED') THEN
    RAISE EXCEPTION 'active or retired venues must be retired/archived, not deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD.status IN ('RETIRED','ARCHIVED') THEN
    RAISE EXCEPTION 'retired venues are immutable';
  END IF;
  IF OLD.status = 'ACTIVE' AND (
    NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name OR
    NEW.wilaya_id IS DISTINCT FROM OLD.wilaya_id OR NEW.daira_id IS DISTINCT FROM OLD.daira_id OR
    NEW.commune_id IS DISTINCT FROM OLD.commune_id OR NEW.status NOT IN ('ACTIVE','RETIRED','ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'active venues must be retired/archived instead of redefined';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_occurrence_venue_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  occurrence_start_at timestamptz;
  occurrence_end_at timestamptz;
BEGIN
  SELECT start_at, end_at INTO occurrence_start_at, occurrence_end_at FROM calendar_occurrences WHERE id = NEW.calendar_occurrence_id;
  IF NEW.start_at IS NOT NULL AND occurrence_start_at IS NOT NULL AND NEW.start_at < occurrence_start_at THEN
    RAISE EXCEPTION 'occurrence venue cannot start before its calendar occurrence';
  END IF;
  IF NEW.end_at IS NOT NULL AND occurrence_end_at IS NOT NULL AND NEW.end_at > occurrence_end_at THEN
    RAISE EXCEPTION 'occurrence venue cannot end after its calendar occurrence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competition_stages_context_trg
  BEFORE INSERT OR UPDATE ON competition_stages
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_competition_stage_context();
CREATE TRIGGER competition_stages_updated_at
  BEFORE UPDATE ON competition_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER calendar_occurrences_context_trg
  BEFORE INSERT OR UPDATE ON calendar_occurrences
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_calendar_occurrence_context();
CREATE TRIGGER calendar_occurrences_updated_at
  BEFORE UPDATE ON calendar_occurrences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER venues_geography_trg
  BEFORE INSERT OR UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_venue_geography();
CREATE TRIGGER venues_protection_trg
  BEFORE UPDATE OR DELETE ON venues
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_venue_catalogue();
CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER occurrence_venues_context_trg
  BEFORE INSERT OR UPDATE ON occurrence_venues
  FOR EACH ROW EXECUTE FUNCTION nssms_validate_occurrence_venue_context();
CREATE TRIGGER occurrence_venues_updated_at
  BEFORE UPDATE ON occurrence_venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();
