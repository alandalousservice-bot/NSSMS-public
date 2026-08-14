const nodeEnv = process.env.NODE_ENV ?? 'development';
export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  authSecret: process.env.AUTH_SECRET ?? 'development-only-change-me',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? ''
};
if (nodeEnv === 'production' && (config.authSecret.length < 32 || !config.databaseUrl)) throw new Error('AUTH_SECRET and DATABASE_URL are required in production');
