# Undertrained

A self-hosted web app for analyzing your Strava training data. Syncs activities and streams from Strava, computes training metrics (TSS, HRSS), and provides interactive charts, maps, and explorer tiles.

Built with Next.js, tRPC, Drizzle ORM, and PostgreSQL.

The repository also holds **Undertrained Indoor**, a native desktop app for indoor cycling built with Rust and Slint, in [`desktop/`](desktop/README.md). It signs in to this web app and uses its `/api/desktop/*` endpoints. Everything else in this README is about the web app.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/)
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- A [Strava API application](https://www.strava.com/settings/api) (for OAuth credentials)

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/flaviendelangle/undertrained.git
cd undertrained
pnpm install
```

### 2. Start PostgreSQL

```bash
docker compose -f docker-compose.dev.yml up -d
podman compose -f docker-compose.dev.yml up -d
```

This starts a PostgreSQL 17 instance on `localhost:5432` with user `undertrained`, password `undertrained`, database `undertrained`.

### 3. Configure environment

Create a `.env.local` file at the project root:

```env
DATABASE_URL=postgresql://undertrained:undertrained@localhost:5432/undertrained
STRAVA_CLIENT_ID=<your-strava-client-id>
STRAVA_CLIENT_SECRET=<your-strava-client-secret>
NEXTAUTH_SECRET=<any-random-string>
NEXTAUTH_URL=http://localhost:3000
STRAVA_WEBHOOK_VERIFY_TOKEN=<any-random-string>
```

To get Strava credentials, create an API application at https://www.strava.com/settings/api with the callback URL set to `http://localhost:3000/api/auth/callback/strava`.

### 4. Push the database schema

```bash
pnpm db:push
```

### 5. Start the dev server

```bash
pnpm dev
```

Open http://localhost:3000 — you'll be redirected to the login page where you can sign in with Strava.

## Scripts

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `pnpm dev`            | Start Next.js dev server                 |
| `pnpm build`          | Production build                         |
| `pnpm start`          | Start production server                  |
| `pnpm db:push`        | Push schema to database (dev)            |
| `pnpm db:generate`    | Generate a migration                     |
| `pnpm db:migrate`     | Run pending migrations                   |
| `pnpm db:studio`      | Open Drizzle Studio (DB browser)         |
| `pnpm lint`           | Run ESLint                               |
| `pnpm test-unit`      | Run Vitest                               |
| `pnpm test-e2e`       | Run Playwright                           |
| `pnpm webhook:view`   | List active Strava webhook subscriptions |
| `pnpm webhook:create` | Register a new webhook subscription      |
| `pnpm webhook:delete` | Delete a webhook subscription            |

## Production deployment

The project includes Docker files for self-hosted deployment: PostgreSQL, the Next.js app, and Caddy as a reverse proxy with automatic HTTPS.

### 1. Configure environment

Create a `.env` file at the project root with all required variables:

```env
# Database
POSTGRES_PASSWORD=<strong-random-password>

# Auth
NEXTAUTH_SECRET=<random-string>
NEXTAUTH_URL=https://yourdomain.com

# Strava OAuth
STRAVA_CLIENT_ID=<your-strava-client-id>
STRAVA_CLIENT_SECRET=<your-strava-client-secret>

# Strava Webhooks (real-time activity sync)
STRAVA_WEBHOOK_VERIFY_TOKEN=<random-string>
STRAVA_WEBHOOK_CALLBACK_URL=https://yourdomain.com/api/strava/webhook

# Caddy
DOMAIN=yourdomain.com
```

| Variable                      | Required | Description                                                                                                                                                          |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`           | Yes      | Password for the PostgreSQL database                                                                                                                                 |
| `NEXTAUTH_SECRET`             | Yes      | Random secret used to sign session cookies                                                                                                                           |
| `NEXTAUTH_URL`                | Yes      | Public URL of the app                                                                                                                                                |
| `STRAVA_CLIENT_ID`            | Yes      | From your [Strava API application](https://www.strava.com/settings/api)                                                                                              |
| `STRAVA_CLIENT_SECRET`        | Yes      | From your Strava API application                                                                                                                                     |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Yes      | Any random string — used to validate the webhook subscription with Strava                                                                                            |
| `STRAVA_WEBHOOK_CALLBACK_URL` | No       | Public webhook URL. When set, the app auto-registers a Strava webhook subscription on startup for real-time activity sync. If omitted, only manual sync is available |
| `DOMAIN`                      | Yes      | Domain name for Caddy to auto-provision HTTPS                                                                                                                        |

Set the Strava API callback URL to `https://yourdomain.com/api/auth/callback/strava` in the [Strava API settings](https://www.strava.com/settings/api).

### 2. Deploy

```bash
# Build and start all services
docker compose up -d

# Run database migrations
docker compose exec app npx drizzle-kit migrate
```

### 3. Webhooks

When `STRAVA_WEBHOOK_CALLBACK_URL` is set, the app automatically registers a Strava webhook subscription when the server starts. New activities, updates, and deletions on Strava are synced in real-time.

If webhooks are not configured or an event is missed, the manual "Sync" button in the app catches any gaps.

For manual subscription management, use the CLI scripts:

```bash
pnpm webhook:view    # List active subscriptions
pnpm webhook:create  # Register a new subscription
pnpm webhook:delete  # Delete a subscription
```
