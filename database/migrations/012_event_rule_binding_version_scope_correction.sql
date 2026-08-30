-- NSSMS-ARCH-007 corrective migration.
-- Event-rule binding conflicts are scoped to one regulation version.

ALTER TABLE event_rule_bindings
  DROP CONSTRAINT event_rule_bindings_conflict_excl;

ALTER TABLE event_rule_bindings
  ADD CONSTRAINT event_rule_bindings_conflict_excl
  EXCLUDE USING gist (
    regulation_version_id WITH =,
    event_id WITH =,
    category_scope_key WITH =,
    stage_level_scope_key WITH =,
    precedence WITH =,
    effective_period WITH &&
  );
