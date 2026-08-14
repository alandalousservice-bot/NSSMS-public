# Migration order

Apply migrations in filename order. `001_initial_schema.sql` creates the baseline; `002_integrity_triggers.sql` adds cross-entity timestamp automation and reinforces audit immutability; `003_default_role_permissions.sql` assigns the documented foundation permissions to the two development administration roles; `004_search_indexes.sql` adds indexes supporting administrative filters. Migrations are intentionally plain SQL and should be applied by a controlled deployment process.
