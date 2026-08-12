# CI/CD

## GitHub Actions (implemented)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs three jobs:

| Job                  | Trigger                            | What it does                                                                                     |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `lint-and-typecheck` | every push/PR to `main`            | `npm run lint`, `npm run typecheck`                                                              |
| `smoke`              | every push/PR, after lint passes   | `@smoke`-tagged tests on `chromium` + `api` — fast PR gate                                       |
| `regression`         | push to `main`, or manual dispatch | Full suite, one matrix job per project (`chromium`/`firefox`/`webkit`/`api`) running in parallel |

Test reports (`reports/`) and failure artifacts — screenshots, videos, traces
under `test-results/` — are uploaded as workflow artifacts on every run
(`if: always()`), win or lose.

### Environment handling in CI

`BASE_URL`/`API_BASE_URL` are set as plain workflow `env:` vars pointing at
the same public practice sites used for local scaffolding
(the-internet.herokuapp.com, jsonplaceholder.typicode.com) — no real
credentials required. CI-level env vars take precedence over the committed
`config/environments/.env.qa` placeholders (dotenv doesn't override
already-set `process.env` values — see `config/env.config.ts`). Point these
at a real target by editing the `env:` block, or by setting repository/
environment variables of the same name in GitHub's UI (use **Secrets**
instead of **Variables** for anything sensitive, e.g. `API_AUTH_TOKEN`).

### Running the same checks locally

Every CI step is just the framework's own npm scripts — nothing CI-specific:

```bash
npm run lint
npm run typecheck
npx playwright install --with-deps chromium
BASE_URL=https://the-internet.herokuapp.com API_BASE_URL=https://jsonplaceholder.typicode.com \
  npx playwright test --grep @smoke --project=chromium --project=api
```

## Jenkins

No Jenkinsfile is committed (avoids maintaining a pipeline for a platform
not actually in use), but the framework needs nothing Jenkins-specific — a
declarative pipeline just calls the same npm scripts:

```groovy
pipeline {
  agent {
    docker { image 'mcr.microsoft.com/playwright:v1.62.1-jammy' } // keep in sync with docker/Dockerfile
  }
  environment {
    BASE_URL = 'https://the-internet.herokuapp.com'
    API_BASE_URL = 'https://jsonplaceholder.typicode.com'
    // API_AUTH_TOKEN = credentials('api-auth-token') // once a real API needs auth
  }
  stages {
    stage('Install') {
      steps { sh 'npm ci' }
    }
    stage('Lint & Typecheck') {
      steps {
        sh 'npm run lint'
        sh 'npm run typecheck'
      }
    }
    stage('Smoke') {
      steps { sh 'npx playwright test --grep @smoke --project=chromium --project=api' }
    }
    stage('Regression') {
      when { branch 'main' }
      steps { sh 'npx playwright test' }
    }
  }
  post {
    always {
      archiveArtifacts artifacts: 'reports/**, test-results/**', allowEmptyArchive: true
      junit 'reports/junit/results.xml'
    }
  }
}
```

Using the official `mcr.microsoft.com/playwright` image (same one
[docker/Dockerfile](../docker/Dockerfile) is built from) means no separate
`playwright install --with-deps` step is needed — browsers are preinstalled.

## Azure DevOps

Same idea — an `azure-pipelines.yml` calling the same npm scripts, with
Azure's native test-result publishing pointed at the JUnit output:

```yaml
trigger:
  branches:
    include: [main]

pool:
  vmImage: 'ubuntu-latest'

variables:
  BASE_URL: https://the-internet.herokuapp.com
  API_BASE_URL: https://jsonplaceholder.typicode.com

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: |
      npm run lint
      npm run typecheck
    displayName: 'Lint & typecheck'

  - script: npx playwright install --with-deps chromium
    displayName: 'Install Playwright browser'

  - script: npx playwright test --grep @smoke --project=chromium --project=api
    displayName: 'Smoke tests'

  - script: npx playwright test
    displayName: 'Regression suite'
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')

  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: 'reports/junit/results.xml'

  - task: PublishBuildArtifacts@1
    condition: always()
    inputs:
      pathToPublish: 'reports'
      artifactName: 'test-reports'
```

For a real, sensitive `API_AUTH_TOKEN`, use a
[secret variable](https://learn.microsoft.com/azure/devops/pipelines/process/variables#secret-variables)
or an Azure Key Vault-linked variable group instead of a plain `variables:` entry.

## Tags for CI scoping

`@smoke` / `@regression` (from `src/core/constants/tags.ts`) select subsets
via `--grep`, matching the smoke/regression split used across all three CI
systems above.
