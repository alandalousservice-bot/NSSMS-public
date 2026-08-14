CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations USING btree (name);
CREATE INDEX IF NOT EXISTS idx_institutions_name ON educational_institutions USING btree (name);
CREATE INDEX IF NOT EXISTS idx_participants_name ON participants USING btree (family_name, given_name);
CREATE INDEX IF NOT EXISTS idx_seasons_status_start ON seasons (status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_competitions_status_created ON competitions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_licenses_status_expiry ON sports_licenses (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_results_competition_created ON results (competition_id, created_at DESC);
