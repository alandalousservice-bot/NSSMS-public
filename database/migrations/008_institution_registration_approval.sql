DO $$ BEGIN
  ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'PENDING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO permissions(key,description) VALUES
  ('institution.approve','Approve institution registrations within the association wilaya')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='ASSOCIATION_ADMINISTRATOR' AND p.key='institution.approve'
ON CONFLICT DO NOTHING;
