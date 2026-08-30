-- NSSMS-ARCH-011: additive governed results, revisions, and validation history.
-- Existing results remain LEGACY_UNRESOLVED unless an approved workflow supplies complete context.

ALTER TABLE results
  ADD COLUMN stage_id uuid REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN occurrence_id uuid REFERENCES calendar_occurrences(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN category_id uuid REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN competition_entry_id uuid REFERENCES competition_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN regulation_version_id uuid REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN provenance_source_id uuid REFERENCES regulation_sources(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN governed_status text NOT NULL DEFAULT 'LEGACY_UNRESOLVED'
    CHECK (governed_status IN ('LEGACY_UNRESOLVED','DRAFT','SUBMITTED','VALIDATED','REJECTED','VOID','ARCHIVED'));

CREATE TABLE result_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  prior_snapshot jsonb NOT NULL,
  new_snapshot jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_source_id uuid REFERENCES regulation_sources(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT result_revisions_result_revision_uk UNIQUE (result_id, revision_no),
  CONSTRAINT result_revisions_prior_snapshot_object_ck CHECK (jsonb_typeof(prior_snapshot) = 'object'),
  CONSTRAINT result_revisions_new_snapshot_object_ck CHECK (jsonb_typeof(new_snapshot) = 'object')
);

CREATE TABLE result_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no >= 0),
  decision text NOT NULL CHECK (decision IN ('VALIDATED','REJECTED','VOID')),
  validator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  supersedes_validation_id uuid REFERENCES result_validations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  notes text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT result_validations_result_revision_decision_uk UNIQUE (result_id, revision_no, decision)
);

CREATE INDEX results_governed_stage_occurrence_idx ON results (stage_id, occurrence_id, governed_status);
CREATE INDEX results_governed_event_category_idx ON results (event_id, category_id, governed_status);
CREATE INDEX results_governed_entry_idx ON results (competition_entry_id) WHERE competition_entry_id IS NOT NULL;
CREATE INDEX results_governed_regulation_idx ON results (regulation_version_id, governed_status) WHERE regulation_version_id IS NOT NULL;
CREATE INDEX results_current_validated_idx ON results (stage_id, occurrence_id, event_id, category_id)
  WHERE governed_status = 'VALIDATED';
CREATE INDEX result_revisions_result_sequence_idx ON result_revisions (result_id, revision_no DESC);
CREATE INDEX result_validations_result_lookup_idx ON result_validations (result_id, revision_no, decided_at DESC);

CREATE OR REPLACE FUNCTION nssms_validate_result_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  occurrence_stage_id uuid; occurrence_event_id uuid; occurrence_category_id uuid; occurrence_version_id uuid;
  stage_competition_id uuid; stage_version_id uuid;
  entry_stage_id uuid; entry_category_id uuid; entry_version_id uuid;
  source_version_id uuid;
BEGIN
  IF NEW.governed_status = 'LEGACY_UNRESOLVED' THEN
    IF NEW.stage_id IS NOT NULL OR NEW.occurrence_id IS NOT NULL OR NEW.event_id IS NOT NULL OR
       NEW.category_id IS NOT NULL OR NEW.competition_entry_id IS NOT NULL OR NEW.regulation_version_id IS NOT NULL OR
       NEW.provenance_source_id IS NOT NULL THEN
      RAISE EXCEPTION 'legacy unresolved results must not contain partial governed context';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage_id IS NULL OR NEW.occurrence_id IS NULL OR NEW.event_id IS NULL OR NEW.category_id IS NULL OR
     NEW.competition_entry_id IS NULL OR NEW.regulation_version_id IS NULL THEN
    RAISE EXCEPTION 'governed results require complete operational context';
  END IF;
  SELECT stage_id, event_id, category_id, regulation_version_id
    INTO occurrence_stage_id, occurrence_event_id, occurrence_category_id, occurrence_version_id
    FROM calendar_occurrences WHERE id = NEW.occurrence_id;
  SELECT competition_id, regulation_version_id INTO stage_competition_id, stage_version_id
    FROM competition_stages WHERE id = NEW.stage_id;
  SELECT stage_id, category_id, regulation_version_id INTO entry_stage_id, entry_category_id, entry_version_id
    FROM competition_entries WHERE id = NEW.competition_entry_id;
  IF NEW.competition_id IS DISTINCT FROM stage_competition_id THEN RAISE EXCEPTION 'result competition must match its stage competition'; END IF;
  IF occurrence_stage_id IS DISTINCT FROM NEW.stage_id THEN RAISE EXCEPTION 'result occurrence must belong to its stage'; END IF;
  IF occurrence_event_id IS DISTINCT FROM NEW.event_id THEN RAISE EXCEPTION 'result event must match its occurrence'; END IF;
  IF occurrence_category_id IS DISTINCT FROM NEW.category_id THEN RAISE EXCEPTION 'result category must match its occurrence'; END IF;
  IF entry_stage_id IS DISTINCT FROM NEW.stage_id OR entry_category_id IS DISTINCT FROM NEW.category_id THEN
    RAISE EXCEPTION 'result competition entry must belong to its stage and category';
  END IF;
  IF stage_version_id IS DISTINCT FROM NEW.regulation_version_id OR occurrence_version_id IS DISTINCT FROM NEW.regulation_version_id OR entry_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
    RAISE EXCEPTION 'result regulation version must match its stage, occurrence, and entry';
  END IF;
  IF NEW.provenance_source_id IS NOT NULL THEN
    SELECT regulation_version_id INTO source_version_id FROM regulation_sources WHERE id = NEW.provenance_source_id;
    IF source_version_id IS DISTINCT FROM NEW.regulation_version_id THEN RAISE EXCEPTION 'result provenance source must match its regulation version'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_result_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE context_changed boolean; payload_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.governed_status NOT IN ('LEGACY_UNRESOLVED','DRAFT') THEN RAISE EXCEPTION 'governed or historical results cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF NOT (
    (OLD.governed_status = 'LEGACY_UNRESOLVED' AND NEW.governed_status = 'LEGACY_UNRESOLVED') OR
    (OLD.governed_status = 'DRAFT' AND NEW.governed_status IN ('DRAFT','SUBMITTED','ARCHIVED')) OR
    (OLD.governed_status = 'SUBMITTED' AND NEW.governed_status IN ('SUBMITTED','VALIDATED','REJECTED','VOID','ARCHIVED')) OR
    (OLD.governed_status = 'VALIDATED' AND NEW.governed_status IN ('VALIDATED','ARCHIVED')) OR
    (OLD.governed_status IN ('REJECTED','VOID') AND NEW.governed_status IN (OLD.governed_status,'ARCHIVED')) OR
    (OLD.governed_status = 'ARCHIVED' AND NEW.governed_status = 'ARCHIVED')
  ) THEN RAISE EXCEPTION 'result lifecycle transitions must be forward-only'; END IF;
  IF NEW.governed_status IN ('VALIDATED','REJECTED','VOID') AND NEW.governed_status IS DISTINCT FROM OLD.governed_status AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'result validation status must be established by an immutable validation record';
  END IF;
  context_changed := NEW.competition_id IS DISTINCT FROM OLD.competition_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id OR
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.event_id IS DISTINCT FROM OLD.event_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.competition_entry_id IS DISTINCT FROM OLD.competition_entry_id OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR NEW.provenance_source_id IS DISTINCT FROM OLD.provenance_source_id;
  payload_changed := NEW.result_data IS DISTINCT FROM OLD.result_data;
  IF OLD.governed_status IN ('VALIDATED','REJECTED','VOID','ARCHIVED') AND (context_changed OR payload_changed) THEN
    RAISE EXCEPTION 'validated or historical result context and payload are immutable; create a revision';
  END IF;
  IF NEW.governed_status = 'ARCHIVED' AND OLD.governed_status <> 'ARCHIVED' THEN
    IF context_changed OR payload_changed OR OLD.archived_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'result archive transition must be status-only and database-controlled';
    END IF;
    NEW.archived_at := now();
  ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'result archival timestamp is database-controlled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_result_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_no integer; result_status text; result_source uuid;
BEGIN
  SELECT governed_status, provenance_source_id INTO result_status, result_source FROM results WHERE id = NEW.result_id FOR UPDATE;
  SELECT COALESCE(MAX(revision_no), 0) INTO current_no FROM result_revisions WHERE result_id = NEW.result_id;
  IF result_status IN ('LEGACY_UNRESOLVED','ARCHIVED') THEN RAISE EXCEPTION 'legacy unresolved or archived results cannot receive revisions'; END IF;
  IF NEW.revision_no <> current_no + 1 THEN RAISE EXCEPTION 'result revision numbers must be sequential'; END IF;
  IF result_source IS NOT NULL AND NEW.regulation_source_id IS NOT NULL AND result_source IS DISTINCT FROM NEW.regulation_source_id THEN RAISE EXCEPTION 'result revision provenance must match the result source'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_prevent_result_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'result revisions are append-only'; END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_result_validation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_no integer; result_status text; existing_id uuid; existing_revision integer;
BEGIN
  SELECT governed_status INTO result_status FROM results WHERE id = NEW.result_id FOR UPDATE;
  SELECT COALESCE(MAX(revision_no), 0) INTO current_no FROM result_revisions WHERE result_id = NEW.result_id;
  IF NEW.revision_no > current_no THEN RAISE EXCEPTION 'validation must reference an existing result revision'; END IF;
  IF NEW.revision_no > 0 AND NOT EXISTS (SELECT 1 FROM result_revisions WHERE result_id=NEW.result_id AND revision_no=NEW.revision_no) THEN RAISE EXCEPTION 'validation must reference the exact committed revision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.validator_user_id AND status='ACTIVE') THEN RAISE EXCEPTION 'result validator must be an active user'; END IF;
  IF NEW.decision = 'VALIDATED' AND result_status NOT IN ('SUBMITTED','VALIDATED') THEN RAISE EXCEPTION 'only submitted governed results may be validated'; END IF;
  SELECT validation.id, validation.revision_no INTO existing_id, existing_revision FROM result_validations validation
   WHERE validation.result_id=NEW.result_id AND validation.decision='VALIDATED'
     AND NOT EXISTS (SELECT 1 FROM result_validations successor WHERE successor.supersedes_validation_id=validation.id)
   LIMIT 1;
  IF existing_id IS NOT NULL AND NEW.decision='VALIDATED' AND NEW.supersedes_validation_id IS DISTINCT FROM existing_id THEN
    RAISE EXCEPTION 'a current official validation must be explicitly superseded';
  END IF;
  IF NEW.supersedes_validation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM result_validations WHERE id=NEW.supersedes_validation_id AND result_id=NEW.result_id) THEN
    RAISE EXCEPTION 'validation may only supersede a validation of the same result';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_commit_result_validation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'VALIDATED' THEN
    UPDATE results SET governed_status='VALIDATED', updated_at=now() WHERE id=NEW.result_id;
  ELSIF NEW.decision = 'REJECTED' THEN
    UPDATE results SET governed_status='REJECTED', updated_at=now() WHERE id=NEW.result_id;
  ELSIF NEW.decision = 'VOID' THEN
    UPDATE results SET governed_status='VOID', updated_at=now() WHERE id=NEW.result_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_prevent_result_validation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'result validations are append-only'; END;
$$;

CREATE TRIGGER results_context_trg BEFORE INSERT OR UPDATE ON results FOR EACH ROW EXECUTE FUNCTION nssms_validate_result_context();
CREATE TRIGGER results_history_trg BEFORE UPDATE OR DELETE ON results FOR EACH ROW EXECUTE FUNCTION nssms_protect_result_history();
CREATE TRIGGER result_revisions_context_trg BEFORE INSERT ON result_revisions FOR EACH ROW EXECUTE FUNCTION nssms_validate_result_revision();
CREATE TRIGGER result_revisions_immutable_trg BEFORE UPDATE OR DELETE ON result_revisions FOR EACH ROW EXECUTE FUNCTION nssms_prevent_result_revision_mutation();
CREATE TRIGGER result_validations_context_trg BEFORE INSERT ON result_validations FOR EACH ROW EXECUTE FUNCTION nssms_validate_result_validation();
CREATE TRIGGER result_validations_commit_trg AFTER INSERT ON result_validations FOR EACH ROW EXECUTE FUNCTION nssms_commit_result_validation();
CREATE TRIGGER result_validations_immutable_trg BEFORE UPDATE OR DELETE ON result_validations FOR EACH ROW EXECUTE FUNCTION nssms_prevent_result_validation_mutation();

-- audit_logs remains the established audit store. These database triggers cannot reliably identify the acting user;
-- result/revision/validation/void/archive audit emission is therefore an authorized service/API-layer responsibility.
