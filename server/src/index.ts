import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const env = process.env;
const here = fileURLToPath(new URL('.', import.meta.url));
const server = startServer({
  port: Number(env.PORT ?? 3001),
  host: env.HOST ?? '0.0.0.0',
  corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : '*',
  // Serve the built client when present so one process can host everything.
  staticDir: env.STATIC_DIR ?? `${here}../../client/dist`,
  dataDir: env.DATA_DIR ?? `${here}../data`,
  disconnectGraceMs: Number(env.DISCONNECT_GRACE_MS ?? 60_000),
});

server.ready.then((port) => console.log(`IRON FRONT server listening on :${port}`));

const shutdown = async () => {
  console.log('Shutting down…');
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
