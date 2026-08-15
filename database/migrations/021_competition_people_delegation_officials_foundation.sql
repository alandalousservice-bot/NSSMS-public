-- NSSMS-ARCH-010: operational people, delegations, and officials foundation.

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participant_id uuid REFERENCES participants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  given_name text NOT NULL,
  family_name text NOT NULL,
  date_of_birth date,
  contact_email text,
  contact_phone text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT people_name_nonblank_ck CHECK (btrim(given_name) <> '' AND btrim(family_name) <> '')
);
CREATE UNIQUE INDEX people_user_uk ON people(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX people_participant_uk ON people(participant_id) WHERE participant_id IS NOT NULL;

CREATE TABLE delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  institution_id uuid REFERENCES educational_institutions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  representing_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  programme_region_id uuid REFERENCES programme_regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text, name text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT delegations_representation_one_ck CHECK (num_nonnulls(institution_id, representing_organization_id) = 1),
  CONSTRAINT delegations_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT delegations_code_nonblank_ck CHECK (code IS NULL OR btrim(code) <> '')
);
CREATE UNIQUE INDEX delegations_stage_code_uk ON delegations(stage_id, code) WHERE code IS NOT NULL;
CREATE INDEX delegations_stage_idx ON delegations(stage_id, status);

CREATE TABLE delegation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delegation_id uuid NOT NULL REFERENCES delegations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role text NOT NULL, valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delegation_members_role_nonblank_ck CHECK (btrim(role) <> ''),
  CONSTRAINT delegation_members_period_ck CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX delegation_members_current_uk ON delegation_members(delegation_id, person_id, role) WHERE valid_to IS NULL;

CREATE TABLE competition_officials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), person_id uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  official_type text NOT NULL, accreditation_reference text, accreditation_data jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT competition_officials_type_nonblank_ck CHECK (btrim(official_type) <> ''),
  CONSTRAINT competition_officials_accreditation_object_ck CHECK (accreditation_data IS NULL OR jsonb_typeof(accreditation_data) = 'object')
);
CREATE INDEX competition_officials_person_status_idx ON competition_officials(person_id, status);

CREATE TABLE official_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), official_id uuid NOT NULL REFERENCES competition_officials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  occurrence_id uuid REFERENCES calendar_occurrences(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ASSIGNED','COMPLETED','ARCHIVED')),
  assigned_at timestamptz NOT NULL DEFAULT now(), valid_from timestamptz, valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  occurrence_scope_key text GENERATED ALWAYS AS (COALESCE(occurrence_id::text, 'STAGE')) STORED,
  CONSTRAINT official_assignments_role_nonblank_ck CHECK (btrim(role) <> ''),
  CONSTRAINT official_assignments_period_ck CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX official_assignments_active_uk ON official_assignments(official_id, stage_id, occurrence_scope_key, role) WHERE status = 'ASSIGNED';

CREATE OR REPLACE FUNCTION nssms_stage_is_governed(target_stage_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT status IN ('ACTIVE','RESULTS','CLOSED','ARCHIVED') FROM competition_stages WHERE id = target_stage_id
$$;

CREATE OR REPLACE FUNCTION nssms_validate_delegation_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage_region uuid;
BEGIN
  SELECT programme_region_id INTO stage_region FROM competition_stages WHERE id=NEW.stage_id;
  IF NEW.programme_region_id IS NOT NULL AND NEW.programme_region_id IS DISTINCT FROM stage_region THEN RAISE EXCEPTION 'delegation programme region must match its stage'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION nssms_validate_official_assignment_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occurrence_stage uuid;
BEGIN
  IF NEW.occurrence_id IS NOT NULL THEN
    SELECT stage_id INTO occurrence_stage FROM calendar_occurrences WHERE id=NEW.occurrence_id;
    IF occurrence_stage IS DISTINCT FROM NEW.stage_id THEN RAISE EXCEPTION 'official assignment occurrence must belong to its stage'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION nssms_protect_delegation_member_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_delegation uuid; target_stage uuid;
BEGIN
  target_delegation := CASE WHEN TG_OP='DELETE' THEN OLD.delegation_id ELSE NEW.delegation_id END;
  SELECT stage_id INTO target_stage FROM delegations WHERE id=target_delegation;
  IF TG_OP='DELETE' THEN
    IF nssms_stage_is_governed(target_stage) THEN RAISE EXCEPTION 'governed delegation memberships cannot be deleted'; END IF; RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND nssms_stage_is_governed(target_stage) AND (NEW.delegation_id IS DISTINCT FROM OLD.delegation_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to) THEN
    RAISE EXCEPTION 'governed delegation membership identity is immutable';
  END IF; RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION nssms_protect_official_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_stage uuid; target_occurrence uuid; governed boolean;
BEGIN
  target_stage := CASE WHEN TG_OP='DELETE' THEN OLD.stage_id ELSE NEW.stage_id END; target_occurrence := CASE WHEN TG_OP='DELETE' THEN OLD.occurrence_id ELSE NEW.occurrence_id END;
  governed := nssms_stage_is_governed(target_stage) OR EXISTS (SELECT 1 FROM calendar_occurrences WHERE id=target_occurrence AND status IN ('PUBLISHED','COMPLETED','ARCHIVED'));
  IF TG_OP='DELETE' THEN IF governed OR OLD.status IN ('COMPLETED','ARCHIVED') THEN RAISE EXCEPTION 'governed official assignments cannot be deleted'; END IF; RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND (governed OR OLD.status IN ('COMPLETED','ARCHIVED')) AND (NEW.official_id IS DISTINCT FROM OLD.official_id OR NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to) THEN RAISE EXCEPTION 'governed official assignment identity is immutable'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER delegations_context_trg BEFORE INSERT OR UPDATE ON delegations FOR EACH ROW EXECUTE FUNCTION nssms_validate_delegation_context();
CREATE TRIGGER delegations_updated_at BEFORE UPDATE ON delegations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER delegation_members_history_trg BEFORE UPDATE OR DELETE ON delegation_members FOR EACH ROW EXECUTE FUNCTION nssms_protect_delegation_member_history();
CREATE TRIGGER delegation_members_updated_at BEFORE UPDATE ON delegation_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER competition_officials_updated_at BEFORE UPDATE ON competition_officials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER official_assignments_context_trg BEFORE INSERT OR UPDATE ON official_assignments FOR EACH ROW EXECUTE FUNCTION nssms_validate_official_assignment_context();
CREATE TRIGGER official_assignments_history_trg BEFORE UPDATE OR DELETE ON official_assignments FOR EACH ROW EXECUTE FUNCTION nssms_protect_official_assignment_history();
CREATE TRIGGER official_assignments_updated_at BEFORE UPDATE ON official_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
