const nodeEnv = process.env.NODE_ENV ?? 'development';
const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
const developmentOrigins = 'http://localhost:5173,http://127.0.0.1:5173';
// Canonical variable is CORS_ALLOWED_ORIGINS; CORS_ORIGINS is accepted as an alias so
// deployment templates can use either spelling. Explicit origins only; '*' is rejected.
const configuredOrigins = process.env.CORS_ORIGINS ?? process.env.CORS_ALLOWED_ORIGINS ?? process.env.FRONTEND_ORIGIN;
const origins = (configuredOrigins ?? developmentOrigins).split(',').map((origin) => origin.trim()).filter(Boolean);
if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');
if (!origins.length || origins.includes('*')) throw new Error('CORS_ALLOWED_ORIGINS must contain explicit origins only');

// AUTH_SECRET policy:
// - NODE_ENV=production (production and remotely accessible pilot/staging deployments):
//     an explicit AUTH_SECRET is REQUIRED, must be at least 32 characters, and must not
//     match a known placeholder/default value. Startup fails fast otherwise.
// - NODE_ENV=development|test only: an isolated development fallback may be used so the
//     API boots for local work without configuration. Never valid outside a developer machine.
// Secret values are never logged or echoed in errors.
const developmentOnlyAuthSecretFallback = 'development-only-change-me';
const knownWeakAuthSecrets = new Set([
  developmentOnlyAuthSecretFallback,
  'local-development-secret-change-me',
  'replace-with-a-long-random-development-secret',
  'change-me',
  'changeme',
  'secret',
  'auth-secret',
  'ci-only-not-a-production-secret'
]);
const explicitAuthSecretProvided = typeof process.env.AUTH_SECRET === 'string' && process.env.AUTH_SECRET.length > 0;
const authSecret = explicitAuthSecretProvided ? process.env.AUTH_SECRET! : developmentOnlyAuthSecretFallback;
if (!explicitAuthSecretProvided && nodeEnv === 'production') throw new Error('AUTH_SECRET is required when NODE_ENV=production');
if (nodeEnv === 'production') {
  if (knownWeakAuthSecrets.has(authSecret)) throw new Error('AUTH_SECRET must not be a known weak or default value');
  if (authSecret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters long');
}

export const config = {
  nodeEnv,
  port: positiveInteger('PORT', 3000),
  authSecret,
  frontendOrigin: origins[0],
  corsOrigins: origins,
  databaseUrl: process.env.DATABASE_URL ?? '',
  bodyLimit: positiveInteger('BODY_LIMIT_BYTES', 1_048_576),
  requestTimeoutMs: positiveInteger('REQUEST_TIMEOUT_MS', 30_000),
  rateLimitMax: positiveInteger('RATE_LIMIT_MAX', 100),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  authRateLimitMax: positiveInteger('AUTH_RATE_LIMIT_MAX', 100),
  registrationRateLimitMax: positiveInteger('REGISTRATION_RATE_LIMIT_MAX', 20),
  trustProxy: process.env.TRUST_PROXY === 'true'
};
if (nodeEnv === 'production' && !config.databaseUrl) throw new Error('DATABASE_URL is required in production');
if (nodeEnv === 'production' && !configuredOrigins) throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
