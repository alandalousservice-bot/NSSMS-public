-- NSSMS-ARCH-009: competition participation foundation.
-- Additive migration. Results, qualifications, rankings, awards, delegations, people, officials, and APIs remain out of scope.

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES educational_institutions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  representing_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage_id uuid REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  representation_scope_key text GENERATED ALWAYS AS (
    CASE
      WHEN institution_id IS NOT NULL THEN 'INSTITUTION:' || institution_id::text
      ELSE 'ORGANIZATION:' || representing_organization_id::text
    END
  ) STORED,
  stage_scope_key text GENERATED ALWAYS AS (COALESCE(stage_id::text, 'UNSCOPED')) STORED,
  CONSTRAINT teams_representation_one_ck CHECK (num_nonnulls(institution_id, representing_organization_id) = 1),
  CONSTRAINT teams_name_nonblank_ck CHECK (btrim(name) <> ''),
  CONSTRAINT teams_scope_name_uk UNIQUE (stage_scope_key, category_id, representation_scope_key, name)
);

CREATE INDEX teams_category_stage_status_idx ON teams (category_id, stage_id, status);
CREATE INDEX teams_institution_idx ON teams (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX teams_organization_idx ON teams (representing_organization_id) WHERE representing_organization_id IS NOT NULL;

CREATE TABLE team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_role_nonblank_ck CHECK (btrim(role) <> ''),
  CONSTRAINT team_members_period_ck CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX team_members_current_participant_uk
  ON team_members (team_id, participant_id)
  WHERE valid_to IS NULL;
CREATE INDEX team_members_participant_idx ON team_members (participant_id, valid_from DESC);

CREATE TABLE competition_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  institution_id uuid REFERENCES educational_institutions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  representing_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('INDIVIDUAL','TEAM')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')),
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  eligibility_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  representation_scope_key text GENERATED ALWAYS AS (
    CASE
      WHEN institution_id IS NOT NULL THEN 'INSTITUTION:' || institution_id::text
      ELSE 'ORGANIZATION:' || representing_organization_id::text
    END
  ) STORED,
  CONSTRAINT competition_entries_representation_one_ck CHECK (num_nonnulls(institution_id, representing_organization_id) = 1),
  CONSTRAINT competition_entries_eligibility_data_object_ck CHECK (eligibility_data IS NULL OR jsonb_typeof(eligibility_data) = 'object')
);

CREATE INDEX competition_entries_stage_category_status_idx ON competition_entries (stage_id, category_id, status);
CREATE INDEX competition_entries_institution_idx ON competition_entries (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX competition_entries_organization_idx ON competition_entries (representing_organization_id) WHERE representing_organization_id IS NOT NULL;

CREATE TABLE individual_entries (
  competition_entry_id uuid PRIMARY KEY REFERENCES competition_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participation_state text NOT NULL CHECK (participation_state IN ('DRAFT','SUBMITTED','VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX individual_entries_validated_subject_uk
  ON individual_entries (stage_id, category_id, participant_id)
  WHERE participation_state = 'VALIDATED';
CREATE INDEX individual_entries_participant_idx ON individual_entries (participant_id, stage_id, category_id);

CREATE TABLE team_entries (
  competition_entry_id uuid PRIMARY KEY REFERENCES competition_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  participation_state text NOT NULL CHECK (participation_state IN ('DRAFT','SUBMITTED','VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_entries_validated_subject_uk
  ON team_entries (stage_id, category_id, team_id)
  WHERE participation_state = 'VALIDATED';
CREATE INDEX team_entries_team_idx ON team_entries (team_id, stage_id, category_id);

CREATE OR REPLACE FUNCTION nssms_validate_team_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  category_version_id uuid;
  stage_version_id uuid;
BEGIN
  SELECT regulation_version_id INTO category_version_id FROM categories WHERE id = NEW.category_id;
  IF NEW.stage_id IS NOT NULL THEN
    SELECT regulation_version_id INTO stage_version_id FROM competition_stages WHERE id = NEW.stage_id;
    IF category_version_id IS DISTINCT FROM stage_version_id THEN
      RAISE EXCEPTION 'team category must use the regulation version of its stage';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_team_member_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  team_institution_id uuid;
  team_organization_id uuid;
  participant_institution_id uuid;
  participant_organization_id uuid;
BEGIN
  SELECT institution_id, representing_organization_id
    INTO team_institution_id, team_organization_id
    FROM teams WHERE id = NEW.team_id;
  SELECT participant.institution_id, institution.organization_id
    INTO participant_institution_id, participant_organization_id
    FROM participants participant
    JOIN educational_institutions institution ON institution.id = participant.institution_id
   WHERE participant.id = NEW.participant_id;
  IF team_institution_id IS NOT NULL AND participant_institution_id IS DISTINCT FROM team_institution_id THEN
    RAISE EXCEPTION 'team member participant must belong to the team institution';
  END IF;
  IF team_organization_id IS NOT NULL AND participant_organization_id IS DISTINCT FROM team_organization_id THEN
    RAISE EXCEPTION 'team member participant must belong to the team organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_competition_entry_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stage_version_id uuid;
  stage_programme_id uuid;
  category_version_id uuid;
  category_programme_id uuid;
BEGIN
  SELECT regulation_version_id, programme_id INTO stage_version_id, stage_programme_id
    FROM competition_stages WHERE id = NEW.stage_id;
  IF stage_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
    RAISE EXCEPTION 'competition entry must use the regulation version of its stage';
  END IF;
  SELECT regulation_version_id, programme_id INTO category_version_id, category_programme_id
    FROM categories WHERE id = NEW.category_id;
  IF category_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
    RAISE EXCEPTION 'competition entry category must use its regulation version';
  END IF;
  IF category_programme_id IS NOT NULL AND category_programme_id IS DISTINCT FROM stage_programme_id THEN
    RAISE EXCEPTION 'competition entry category must belong to the stage programme';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_individual_entry_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_stage_id uuid;
  parent_category_id uuid;
  parent_type text;
  parent_status text;
  parent_institution_id uuid;
  parent_organization_id uuid;
  participant_institution_id uuid;
  participant_organization_id uuid;
BEGIN
  SELECT stage_id, category_id, entry_type, status, institution_id, representing_organization_id
    INTO parent_stage_id, parent_category_id, parent_type, parent_status, parent_institution_id, parent_organization_id
    FROM competition_entries WHERE id = NEW.competition_entry_id;
  IF parent_type IS DISTINCT FROM 'INDIVIDUAL' THEN
    RAISE EXCEPTION 'individual entry subtype must match an INDIVIDUAL competition entry';
  END IF;
  IF NEW.stage_id IS DISTINCT FROM parent_stage_id THEN
    RAISE EXCEPTION 'individual entry stage must match its competition entry';
  END IF;
  IF NEW.category_id IS DISTINCT FROM parent_category_id THEN
    RAISE EXCEPTION 'individual entry category must match its competition entry';
  END IF;
  IF NEW.participation_state IS DISTINCT FROM parent_status THEN
    RAISE EXCEPTION 'individual entry participation state must match its competition entry status';
  END IF;
  SELECT participant.institution_id, institution.organization_id
    INTO participant_institution_id, participant_organization_id
    FROM participants participant
    JOIN educational_institutions institution ON institution.id = participant.institution_id
   WHERE participant.id = NEW.participant_id;
  IF parent_institution_id IS NOT NULL AND participant_institution_id IS DISTINCT FROM parent_institution_id THEN
    RAISE EXCEPTION 'individual entry participant must belong to its representing institution';
  END IF;
  IF parent_organization_id IS NOT NULL AND participant_organization_id IS DISTINCT FROM parent_organization_id THEN
    RAISE EXCEPTION 'individual entry participant must belong to its representing organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_team_entry_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_stage_id uuid;
  parent_category_id uuid;
  parent_type text;
  parent_status text;
  parent_institution_id uuid;
  parent_organization_id uuid;
  team_stage_id uuid;
  team_category_id uuid;
  team_institution_id uuid;
  team_organization_id uuid;
BEGIN
  SELECT stage_id, category_id, entry_type, status, institution_id, representing_organization_id
    INTO parent_stage_id, parent_category_id, parent_type, parent_status, parent_institution_id, parent_organization_id
    FROM competition_entries WHERE id = NEW.competition_entry_id;
  IF parent_type IS DISTINCT FROM 'TEAM' THEN
    RAISE EXCEPTION 'team entry subtype must match a TEAM competition entry';
  END IF;
  IF NEW.stage_id IS DISTINCT FROM parent_stage_id THEN
    RAISE EXCEPTION 'team entry stage must match its competition entry';
  END IF;
  IF NEW.category_id IS DISTINCT FROM parent_category_id THEN
    RAISE EXCEPTION 'team entry category must match its competition entry';
  END IF;
  IF NEW.participation_state IS DISTINCT FROM parent_status THEN
    RAISE EXCEPTION 'team entry participation state must match its competition entry status';
  END IF;
  SELECT stage_id, category_id, institution_id, representing_organization_id
    INTO team_stage_id, team_category_id, team_institution_id, team_organization_id
    FROM teams WHERE id = NEW.team_id;
  IF team_category_id IS DISTINCT FROM parent_category_id THEN
    RAISE EXCEPTION 'team entry team category must match its competition entry';
  END IF;
  IF team_stage_id IS NOT NULL AND team_stage_id IS DISTINCT FROM parent_stage_id THEN
    RAISE EXCEPTION 'team entry team stage must match its competition entry';
  END IF;
  IF team_institution_id IS DISTINCT FROM parent_institution_id OR
     team_organization_id IS DISTINCT FROM parent_organization_id THEN
    RAISE EXCEPTION 'team entry team representation must match its competition entry';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_competition_entry_subtypes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_entry_id uuid;
  parent_type text;
  parent_status text;
  individual_count integer;
  team_count integer;
  inconsistent_count integer;
BEGIN
  IF TG_TABLE_NAME = 'competition_entries' THEN
    target_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.competition_entry_id ELSE NEW.competition_entry_id END;
  END IF;
  SELECT entry_type, status INTO parent_type, parent_status FROM competition_entries WHERE id = target_entry_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO individual_count FROM individual_entries WHERE competition_entry_id = target_entry_id;
  SELECT count(*) INTO team_count FROM team_entries WHERE competition_entry_id = target_entry_id;
  IF individual_count > 0 AND team_count > 0 THEN
    RAISE EXCEPTION 'competition entry must not have both individual and team subtypes';
  END IF;
  IF (individual_count = 1 AND parent_type <> 'INDIVIDUAL') OR
     (team_count = 1 AND parent_type <> 'TEAM') THEN
    RAISE EXCEPTION 'competition entry subtype must match its entry type';
  END IF;
  SELECT count(*) INTO inconsistent_count
    FROM competition_entries entry
    LEFT JOIN individual_entries individual ON individual.competition_entry_id = entry.id
    LEFT JOIN team_entries team ON team.competition_entry_id = entry.id
   WHERE entry.id = target_entry_id
     AND (
       (individual.competition_entry_id IS NOT NULL AND (
         individual.stage_id IS DISTINCT FROM entry.stage_id OR
         individual.category_id IS DISTINCT FROM entry.category_id OR
         individual.participation_state IS DISTINCT FROM entry.status
       )) OR
       (team.competition_entry_id IS NOT NULL AND (
         team.stage_id IS DISTINCT FROM entry.stage_id OR
         team.category_id IS DISTINCT FROM entry.category_id OR
         team.participation_state IS DISTINCT FROM entry.status
       ))
     );
  IF inconsistent_count > 0 THEN
    RAISE EXCEPTION 'competition entry subtype context must remain consistent with its parent';
  END IF;
  IF parent_status IN ('VALIDATED','WITHDRAWN','ARCHIVED') AND individual_count + team_count <> 1 THEN
    RAISE EXCEPTION 'validated or historical competition entry must have exactly one subtype';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_synchronize_entry_participation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE individual_entries SET participation_state = NEW.status WHERE competition_entry_id = NEW.id;
    UPDATE team_entries SET participation_state = NEW.status WHERE competition_entry_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_competition_entry_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  protected_fields_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'submitted or historical competition entries cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','SUBMITTED','REJECTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED','VALIDATED','WITHDRAWN','REJECTED')) OR
    (OLD.status = 'VALIDATED' AND NEW.status IN ('VALIDATED','WITHDRAWN','ARCHIVED')) OR
    (OLD.status = 'WITHDRAWN' AND NEW.status IN ('WITHDRAWN','ARCHIVED')) OR
    (OLD.status = 'REJECTED' AND NEW.status IN ('REJECTED','ARCHIVED')) OR
    (OLD.status = 'ARCHIVED' AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'competition entry lifecycle transitions must be forward-only';
  END IF;
  protected_fields_changed :=
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.institution_id IS DISTINCT FROM OLD.institution_id OR
    NEW.representing_organization_id IS DISTINCT FROM OLD.representing_organization_id OR
    NEW.entry_type IS DISTINCT FROM OLD.entry_type OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR
    NEW.eligibility_data IS DISTINCT FROM OLD.eligibility_data OR
    NEW.archived_at IS DISTINCT FROM OLD.archived_at;
  IF OLD.status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED') AND protected_fields_changed THEN
    RAISE EXCEPTION 'validated or historical competition entry identity and context are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_entry_subtype_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
  identity_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status FROM competition_entries WHERE id = OLD.competition_entry_id;
    IF parent_status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED') THEN
      RAISE EXCEPTION 'validated or historical competition entry subtypes cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO parent_status FROM competition_entries WHERE id = NEW.competition_entry_id;
  IF TG_TABLE_NAME = 'individual_entries' THEN
    identity_changed := NEW.participant_id IS DISTINCT FROM OLD.participant_id OR
      NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.category_id IS DISTINCT FROM OLD.category_id;
  ELSE
    identity_changed := NEW.team_id IS DISTINCT FROM OLD.team_id OR
      NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.category_id IS DISTINCT FROM OLD.category_id;
  END IF;
  IF parent_status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED') AND identity_changed THEN
    RAISE EXCEPTION 'validated or historical competition entry subtype identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_team_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  has_historical_entry boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' OR EXISTS (SELECT 1 FROM team_entries WHERE team_id = OLD.id) THEN
      RAISE EXCEPTION 'governed teams cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM team_entries team_entry
    JOIN competition_entries entry ON entry.id = team_entry.competition_entry_id
    WHERE team_entry.team_id = OLD.id
      AND entry.status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')
  ) INTO has_historical_entry;
  IF has_historical_entry AND (
    NEW.institution_id IS DISTINCT FROM OLD.institution_id OR
    NEW.representing_organization_id IS DISTINCT FROM OLD.representing_organization_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR
    NEW.name IS DISTINCT FROM OLD.name
  ) THEN
    RAISE EXCEPTION 'team identity and context used by historical entries are immutable';
  END IF;
  IF OLD.status IN ('RETIRED','ARCHIVED') THEN
    RAISE EXCEPTION 'retired or archived teams are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_team_member_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_team_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_team_id := OLD.team_id;
    IF EXISTS (
      SELECT 1 FROM team_entries team_entry
      JOIN competition_entries entry ON entry.id = team_entry.competition_entry_id
      WHERE team_entry.team_id = target_team_id
        AND entry.status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')
    ) THEN
      RAISE EXCEPTION 'team membership used by historical entries cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teams_context_trg
  BEFORE INSERT OR UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION nssms_validate_team_context();
CREATE TRIGGER teams_history_trg
  BEFORE UPDATE OR DELETE ON teams FOR EACH ROW EXECUTE FUNCTION nssms_protect_team_history();
CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER team_members_context_trg
  BEFORE INSERT OR UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION nssms_validate_team_member_context();
CREATE TRIGGER team_members_history_trg
  BEFORE DELETE ON team_members FOR EACH ROW EXECUTE FUNCTION nssms_protect_team_member_history();
CREATE TRIGGER team_members_updated_at
  BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER competition_entries_context_trg
  BEFORE INSERT OR UPDATE ON competition_entries FOR EACH ROW EXECUTE FUNCTION nssms_validate_competition_entry_context();
CREATE TRIGGER competition_entries_history_trg
  BEFORE UPDATE OR DELETE ON competition_entries FOR EACH ROW EXECUTE FUNCTION nssms_protect_competition_entry_history();
CREATE TRIGGER competition_entries_state_sync_trg
  AFTER UPDATE OF status ON competition_entries FOR EACH ROW EXECUTE FUNCTION nssms_synchronize_entry_participation_state();
CREATE TRIGGER competition_entries_updated_at
  BEFORE UPDATE ON competition_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER individual_entries_context_trg
  BEFORE INSERT OR UPDATE ON individual_entries FOR EACH ROW EXECUTE FUNCTION nssms_validate_individual_entry_context();
CREATE TRIGGER individual_entries_history_trg
  BEFORE UPDATE OR DELETE ON individual_entries FOR EACH ROW EXECUTE FUNCTION nssms_protect_entry_subtype_history();
CREATE TRIGGER individual_entries_updated_at
  BEFORE UPDATE ON individual_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER team_entries_context_trg
  BEFORE INSERT OR UPDATE ON team_entries FOR EACH ROW EXECUTE FUNCTION nssms_validate_team_entry_context();
CREATE TRIGGER team_entries_history_trg
  BEFORE UPDATE OR DELETE ON team_entries FOR EACH ROW EXECUTE FUNCTION nssms_protect_entry_subtype_history();
CREATE TRIGGER team_entries_updated_at
  BEFORE UPDATE ON team_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE CONSTRAINT TRIGGER competition_entries_subtype_xor_trg
  AFTER INSERT OR UPDATE OR DELETE ON competition_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nssms_validate_competition_entry_subtypes();
CREATE CONSTRAINT TRIGGER individual_entries_subtype_xor_trg
  AFTER INSERT OR UPDATE OR DELETE ON individual_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nssms_validate_competition_entry_subtypes();
CREATE CONSTRAINT TRIGGER team_entries_subtype_xor_trg
  AFTER INSERT OR UPDATE OR DELETE ON team_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nssms_validate_competition_entry_subtypes();
