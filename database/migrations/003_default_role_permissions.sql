INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('SYSTEM_ADMINISTRATOR','NATIONAL_ADMINISTRATOR')
  AND p.key IN ('season.view','season.create','season.submit','season.approve','season.activate','season.close','season.archive','competition.view','competition.create','participant.manage','license.manage','license.verify','result.manage','audit.view')
ON CONFLICT DO NOTHING;
