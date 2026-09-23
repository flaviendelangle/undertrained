# Undertrained Indoor sign-in

The native app uses the existing Strava-backed account through a browser confirmation page. This change does not add an email/password provider and does not expose Strava tokens to desktop clients.

## Deployment

1. Apply migration `0024_desktop_auth.sql` through the normal migration process.
2. Deploy this branch with the existing `NEXTAUTH_URL`, `NEXTAUTH_SECRET` and Strava configuration.
3. Set the native app's server address to that origin. No new Strava redirect URI is required: Strava still returns to the existing web callback.

The new endpoints are:

- `GET /api/desktop/authorize`: validate loopback redirect and S256 challenge, require browser login, render consent.
- `POST /api/desktop/authorize`: verify signed consent bound to the account and request, issue a 60-second code.
- `POST /api/desktop/token`: atomically consume the hashed code with the matching verifier, create a 30-day desktop session.
- `GET /api/desktop/session`: validate the desktop bearer session and return athlete ID/name.
- `DELETE /api/desktop/session`: revoke the presented session.

Desktop sessions grant profile and read-only cycling workout access. They are not accepted by the existing tRPC context. Native APIs derive athlete ownership from the authenticated session.

`GET /api/desktop/workouts` returns `{ workouts: [...] }`, newest updated first. Each entry contains `id`, `name`, `durationSeconds`, nullable `estimatedTss`, `summary`, and `profile` pairs of duration seconds and nullable percent FTP, for example `[600, 80]` means ten minutes at 80% FTP. It lists personal cycling workouts only. Running workouts and built-in templates are excluded. Missing, expired, and revoked bearer tokens return 401; other methods return 405. The endpoint ignores client-supplied athlete IDs and does not allow mutations. Create and edit open `/workouts/new` and `/workouts/{id}` in the browser, using the existing web session. No schema migration beyond desktop authentication is needed.

Codes and session tokens are stored only as hashes. Account data deletion and confirmed Strava deauthorization explicitly revoke pending codes and desktop sessions, since those flows retain the athlete row. A physical athlete deletion also removes credentials through foreign-key cascades. Schedule routine cleanup of expired rows:

```sql
DELETE FROM desktop_codes WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
DELETE FROM desktop_sessions WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
```

The browser confirmation form carries an HMAC over the athlete, redirect, state, challenge and expiry. The callback is restricted to `http://127.0.0.1:PORT/callback` on an unprivileged port. PKCE protects the intercepted-code case, and code consumption is a transactional delete, preventing replay across server instances.

Validation performed: authentication helper tests, TypeScript checking, and ESLint on changed application files. Browser approval through an actual Strava account and a migrated database must be checked after deploying this prerequisite.
