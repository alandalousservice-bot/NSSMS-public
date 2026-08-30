-- NSSMS-ARCH-011 corrective migration: revisions are a continuous raw-payload chain.
-- Revision 0 is the immutable governed base payload in results.result_data.

CREATE OR REPLACE FUNCTION nssms_validate_result_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_no integer; result_status text; result_source uuid; expected_prior jsonb;
BEGIN
  SELECT governed_status, provenance_source_id, COALESCE(result_data, '{}'::jsonb)
    INTO result_status, result_source, expected_prior
    FROM results WHERE id = NEW.result_id FOR UPDATE;
  SELECT COALESCE(MAX(revision_no), 0) INTO current_no FROM result_revisions WHERE result_id = NEW.result_id;
  IF result_status IN ('LEGACY_UNRESOLVED','ARCHIVED') THEN RAISE EXCEPTION 'legacy unresolved or archived results cannot receive revisions'; END IF;
  IF NEW.revision_no <> current_no + 1 THEN RAISE EXCEPTION 'result revision numbers must be sequential'; END IF;
  IF current_no > 0 THEN
    SELECT new_snapshot INTO expected_prior FROM result_revisions WHERE result_id = NEW.result_id AND revision_no = current_no;
  END IF;
  IF NEW.prior_snapshot IS DISTINCT FROM expected_prior THEN
    RAISE EXCEPTION 'result revision prior snapshot must match the immediately preceding payload';
  END IF;
  IF result_source IS NOT NULL AND NEW.regulation_source_id IS NOT NULL AND result_source IS DISTINCT FROM NEW.regulation_source_id THEN RAISE EXCEPTION 'result revision provenance must match the result source'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_result_validation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_no integer; result_status text; existing_id uuid;
BEGIN
  SELECT governed_status INTO result_status FROM results WHERE id = NEW.result_id FOR UPDATE;
  SELECT COALESCE(MAX(revision_no), 0) INTO current_no FROM result_revisions WHERE result_id = NEW.result_id;
  IF NEW.revision_no <> current_no THEN RAISE EXCEPTION 'validation must reference the latest committed result revision'; END IF;
  IF NEW.revision_no > 0 AND NOT EXISTS (SELECT 1 FROM result_revisions WHERE result_id=NEW.result_id AND revision_no=NEW.revision_no) THEN RAISE EXCEPTION 'validation must reference the exact committed revision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.validator_user_id AND status='ACTIVE') THEN RAISE EXCEPTION 'result validator must be an active user'; END IF;
  IF NEW.decision = 'VALIDATED' AND result_status NOT IN ('SUBMITTED','VALIDATED') THEN RAISE EXCEPTION 'only submitted governed results may be validated'; END IF;
  SELECT validation.id INTO existing_id FROM result_validations validation
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

-- Official payload is reproducible without mutating results.result_data:
-- current unsuperseded VALIDATED validation -> revision 0 (base payload) or result_revisions.new_snapshot.
