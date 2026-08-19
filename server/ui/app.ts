import express from 'express';
import * as path from 'path';
import { router } from './routes';

/**
 * The web UI is purely an additional interface over the existing GAP
 * engine — this Express app owns no discovery/generation/execution logic
 * of its own; every route in ./routes.ts calls straight into the same
 * core modules cli/gap*.ts already call. Nothing here changes how the
 * CLI behaves or is invoked.
 */
export function createUiApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(router);
  // The existing HTML report the engine already generates — "View Report"/
  // "Download Report" in the UI just link straight into it, not a rebuilt copy.
  app.use('/reports', express.static(path.resolve(process.cwd(), 'reports')));
  app.use(express.static(path.resolve(__dirname, 'public')));
  return app;
}
