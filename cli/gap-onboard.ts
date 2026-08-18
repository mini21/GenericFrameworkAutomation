import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  registerApplication,
  ApplicationDefinition,
} from '../src/core/config/application-registry';

interface OnboardArgs {
  id: string;
  name: string;
  baseUrl: string;
  apiBaseUrl?: string;
  modules: string[];
  authProfiles: string[];
  defaultBrowser: string;
  browsers: string[];
  dataProfiles: string[];
  startPath?: string;
}

function splitList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseCliArgs(): OnboardArgs {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      name: { type: 'string' },
      baseUrl: { type: 'string' },
      apiBaseUrl: { type: 'string' },
      modules: { type: 'string' },
      authProfiles: { type: 'string' },
      defaultBrowser: { type: 'string', default: 'chromium' },
      browsers: { type: 'string' },
      dataProfiles: { type: 'string' },
      startPath: { type: 'string' },
    },
    strict: true,
  });

  if (!values.id || !values.name || !values.baseUrl) {
    throw new Error(
      'Usage: npm run gap:onboard -- --id=<id> --name="<Display Name>" --baseUrl=<url> ' +
        '[--apiBaseUrl=<url>] [--modules=a,b] [--authProfiles=x,y] [--defaultBrowser=chromium] ' +
        '[--browsers=chromium,firefox,webkit] [--dataProfiles=qa-default] [--startPath=/dashboard.html]',
    );
  }

  return {
    id: values.id,
    name: values.name,
    baseUrl: values.baseUrl,
    apiBaseUrl: values.apiBaseUrl,
    modules: splitList(values.modules, []),
    authProfiles: splitList(values.authProfiles, []),
    defaultBrowser: values.defaultBrowser ?? 'chromium',
    browsers: splitList(values.browsers, [values.defaultBrowser ?? 'chromium']),
    dataProfiles: splitList(values.dataProfiles, ['qa-default']),
    startPath: values.startPath,
  };
}

function updateRegistry(args: OnboardArgs): void {
  registerApplication(args.id, {
    name: args.name,
    baseUrl: args.baseUrl,
    apiBaseUrl: args.apiBaseUrl,
    modules: args.modules,
    authProfiles: args.authProfiles,
    defaultBrowser: args.defaultBrowser as ApplicationDefinition['defaultBrowser'],
    supportedBrowsers: args.browsers as ApplicationDefinition['supportedBrowsers'],
    dataProfiles: args.dataProfiles,
    ...(args.startPath ? { startPath: args.startPath } : {}),
  });
}

function scaffoldApplication(args: OnboardArgs): string[] {
  const appRoot = path.resolve(process.cwd(), 'applications', args.id);
  const dirs = [
    'pages',
    'components',
    'api',
    'fixtures',
    'data',
    'requirements',
    path.join('tests', 'ui'),
    path.join('tests', 'api'),
  ];

  const created: string[] = [];
  for (const dir of dirs) {
    const fullPath = path.join(appRoot, dir);
    fs.mkdirSync(fullPath, { recursive: true });
    const gitkeep = path.join(fullPath, '.gitkeep');
    if (!fs.existsSync(gitkeep) && !fs.readdirSync(fullPath).length) {
      fs.writeFileSync(gitkeep, '');
      created.push(path.relative(process.cwd(), gitkeep));
    }
  }

  const requirementsPath = path.join(appRoot, 'requirements', 'requirements.json');
  if (!fs.existsSync(requirementsPath)) {
    fs.writeFileSync(
      requirementsPath,
      `${JSON.stringify({ requirements: {} }, null, 2)}\n`,
      'utf-8',
    );
    created.push(path.relative(process.cwd(), requirementsPath));
  }

  for (const profile of args.dataProfiles) {
    const dataPath = path.join(appRoot, 'data', `${profile}.json`);
    if (!fs.existsSync(dataPath)) {
      fs.writeFileSync(dataPath, `${JSON.stringify({}, null, 2)}\n`, 'utf-8');
      created.push(path.relative(process.cwd(), dataPath));
    }
  }

  return created;
}

function main(): void {
  const args = parseCliArgs();
  updateRegistry(args);
  const created = scaffoldApplication(args);

  process.stdout.write(`\nGAP: onboarded application "${args.id}" (${args.name})\n\n`);
  process.stdout.write('Registered in config/applications.json.\n\n');
  process.stdout.write('Scaffolding created:\n');
  for (const file of created) {
    process.stdout.write(`  - ${file}\n`);
  }
  process.stdout.write(`\nNext steps:\n`);
  process.stdout.write(
    `  1. Add page objects/API clients under applications/${args.id}/{pages,api}/\n`,
  );
  process.stdout.write(`  2. Fill in applications/${args.id}/requirements/requirements.json\n`);
  process.stdout.write(`  3. Write specs under applications/${args.id}/tests/{ui,api}/\n`);
  process.stdout.write(
    `  4. Run: npm run gap:test -- --application=${args.id} --environment=qa --type=smoke\n\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`\nGAP: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
