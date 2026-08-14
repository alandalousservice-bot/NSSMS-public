ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wilaya_id smallint REFERENCES wilayas(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS daira_id integer REFERENCES dairas(id);
ALTER TABLE educational_institutions ADD COLUMN IF NOT EXISTS daira_id integer REFERENCES dairas(id);
CREATE INDEX IF NOT EXISTS idx_organizations_wilaya ON organizations(wilaya_id);
CREATE INDEX IF NOT EXISTS idx_users_daira ON users(daira_id);
CREATE INDEX IF NOT EXISTS idx_institutions_daira ON educational_institutions(daira_id);
INSERT INTO roles (name, description) VALUES ('DAIRA_OFFICER','Officer operating for one daira') ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (key, description) VALUES ('daira.manage','Manage one daira scope'),('daira.institutions','Manage institutions in one daira') ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='DAIRA_OFFICER' AND p.key IN ('daira.manage','daira.institutions','institution.participants','competition.view','license.verify') ON CONFLICT DO NOTHING;
