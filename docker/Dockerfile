# Keep this tag in sync with the @playwright/test version in package.json
# (currently 1.62.1) — a mismatched image/package version is a common
# source of "browser not found" failures.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# Install dependencies first so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV CI=true

# Override at `docker run` time, e.g. -e ENV=staging.
ENV ENV=qa

CMD ["npm", "test"]
