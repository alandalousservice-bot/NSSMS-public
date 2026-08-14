ALTER TABLE organizations ADD COLUMN IF NOT EXISTS organization_type text NOT NULL DEFAULT 'OTHER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES educational_institutions(id);
CREATE INDEX IF NOT EXISTS idx_users_institution ON users(institution_id);
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_type_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_type_check CHECK (organization_type IN ('MINISTRY','ASSOCIATION','OTHER'));
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(organization_type);

INSERT INTO roles (name, description) VALUES
  ('ASSOCIATION_ADMINISTRATOR','Administrator for one sports association'),
  ('ASSOCIATION_REPRESENTATIVE','Representative operating on behalf of one association'),
  ('MEMBER_INSTITUTION_USER','User for one enrolled educational institution')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('association.manage','Manage one association scope'),
  ('association.represent','Represent one association'),
  ('institution.manage','Manage one enrolled institution'),
  ('institution.participants','Manage participants for one institution')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.name='ASSOCIATION_ADMINISTRATOR' AND p.key IN ('association.manage','association.represent','institution.participants','participant.manage','competition.view','license.manage','result.manage'))
   OR (r.name='ASSOCIATION_REPRESENTATIVE' AND p.key IN ('association.represent','competition.view','participant.manage','license.manage','result.manage'))
   OR (r.name='MEMBER_INSTITUTION_USER' AND p.key IN ('institution.manage','institution.participants','competition.view','license.verify'))
ON CONFLICT DO NOTHING;
