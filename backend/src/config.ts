const nodeEnv = process.env.NODE_ENV ?? 'development';
const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
const origins = (process.env.CORS_ALLOWED_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');
if (!origins.length || origins.includes('*')) throw new Error('CORS_ALLOWED_ORIGINS must contain explicit origins only');
export const config = {
  nodeEnv,
  port: positiveInteger('PORT', 3000),
  authSecret: process.env.AUTH_SECRET ?? 'development-only-change-me',
  frontendOrigin: origins[0],
  corsOrigins: origins,
  databaseUrl: process.env.DATABASE_URL ?? '',
  bodyLimit: positiveInteger('BODY_LIMIT_BYTES', 1_048_576),
  requestTimeoutMs: positiveInteger('REQUEST_TIMEOUT_MS', 30_000),
  rateLimitMax: positiveInteger('RATE_LIMIT_MAX', 100),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  trustProxy: process.env.TRUST_PROXY === 'true'
};
if (nodeEnv === 'production' && (config.authSecret.length < 32 || !config.databaseUrl || config.authSecret === 'development-only-change-me')) throw new Error('AUTH_SECRET and DATABASE_URL are required in production');
