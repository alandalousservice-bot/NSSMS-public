import { buildApp } from './app.js';
import { config } from './config.js';
const app = buildApp();
app.listen({ port: config.port, host: '0.0.0.0' }).then(() => app.log.info({ port: config.port }, 'NSSMS API started')).catch((error) => { app.log.error(error); process.exit(1); });
const shutdown = async (signal: string) => { app.log.info({ signal }, 'Shutting down'); try { await app.close(); process.exit(0); } catch (error) { app.log.error(error); process.exit(1); } };
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
