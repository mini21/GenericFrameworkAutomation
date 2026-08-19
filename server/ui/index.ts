import { createUiApp } from './app';

const port = Number(process.env.GAP_UI_PORT) || 4300;

createUiApp().listen(port, () => {
  process.stdout.write(`\nGAP — Generic Automation Platform (web UI)\n`);
  process.stdout.write(`Open http://localhost:${port} in a browser.\n\n`);
});
