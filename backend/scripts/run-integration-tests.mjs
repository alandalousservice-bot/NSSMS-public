import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for npm run test:integration');
if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required for npm run test:integration');

const node = process.execPath;
const run = (args) => {
  const result = spawnSync(node, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(['scripts/migrate.mjs']);
run(['scripts/prepare-integration-fixture.mjs']);
run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts']);
