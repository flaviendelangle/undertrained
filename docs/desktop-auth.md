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
- `GET /api/desktop/session`: validate the desktop bearer session and return athlete ID/name/language.
- `DELETE /api/desktop/session`: revoke the presented session.

Desktop sessions grant profile access, read-only cycling workout access, and explicit recorded-ride uploads to the connected Strava account. They are not accepted by the existing tRPC context. Native APIs derive athlete ownership from the authenticated session.

`GET /api/desktop/workouts` returns `{ workouts: [...], builtInWorkouts: [...] }`, newest updated first. Each entry contains `id`, `name`, `durationSeconds`, nullable `estimatedTss`, `summary`, and `profile` pairs of duration seconds and nullable percent FTP, for example `[600, 80]` means ten minutes at 80% FTP. The `workouts` array lists personal cycling workouts only. Running workouts are excluded. The additive `builtInWorkouts` array uses the same `BUILT_IN_WORKOUT_IDS` and `builtInWorkout` generator as the website, including account-language labels and current FTP from the rider settings timeline. No workout protocols are copied into the desktop client. Built-in IDs are stable strings; their entries also include `durationLabel` and `referenceFtp`. FTP tests have null estimated TSS because their effort is not known in advance. Their browser link is `/workouts#built-in-workouts`. Older desktop clients ignore the additive array; newer clients treat its absence as an older server without catalogue support. Missing, expired, and revoked bearer tokens return 401; other methods return 405. The endpoint ignores client-supplied athlete IDs and does not allow mutations. Create and edit open `/workouts/new` and `/workouts/{id}` in the browser, using the existing web session. No schema migration beyond desktop authentication is needed.

Codes and session tokens are stored only as hashes. Account data deletion and confirmed Strava deauthorization explicitly revoke pending codes and desktop sessions, since those flows retain the athlete row. A physical athlete deletion also removes credentials through foreign-key cascades. Schedule routine cleanup of expired rows:

```sql
DELETE FROM desktop_codes WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
DELETE FROM desktop_sessions WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
```

The browser confirmation form carries an HMAC over the athlete, redirect, state, challenge and expiry. The callback is restricted to `http://127.0.0.1:PORT/callback` on an unprivileged port. PKCE protects the intercepted-code case, and code consumption is a transactional delete, preventing replay across server instances.

Validation performed: authentication helper tests, TypeScript checking, and ESLint on changed application files. Browser approval through an actual Strava account and a migrated database must be checked after deploying this prerequisite.

The token and session responses include the account `athlete.language` preference. Desktop clients can request `GET /api/desktop/workouts?locale=en-GB` or `?locale=fr-FR` to translate built-in names, summaries and duration labels for a local language override. Without the parameter, the account language still applies. Unsupported or repeated locale parameters return 400 after authentication. This read-only override does not change the account preference or personal workout names.

## Recorded ride uploads

`POST /api/desktop/uploads` accepts `{ name, fitFileBase64 }` with the desktop bearer token and forwards the FIT file to the authenticated athlete's Strava account, using the same trainer-upload flow as the website. The name is limited to 200 characters and the base64 payload to 10 MiB. The server checks the FIT header, declared length and CRC. It ignores client-supplied athlete IDs. Uploads require the existing Strava `activity:write` permission; a 403 asks the rider to reconnect Strava on the website.

A successful submission returns HTTP 202 with `{ uploadId, receipt }`. `GET /api/desktop/uploads?receipt=...` returns `{ activityId, error }`, both nullable while Strava processes the file. The receipt is signed with the existing `NEXTAUTH_SECRET`, bound to the authenticated athlete and valid for seven days. It grants no access without a live desktop bearer token. Polling another athlete's receipt, tampering with it, or using an expired receipt returns 400. No database migration is required.

Submissions are limited to ten per minute per athlete; status checks to ninety. Responses use `Cache-Control: no-store`. A stable external ID derived from the athlete and FIT contents accompanies each upload. Clients should persist the returned receipt and retry status checks without submitting the file again. A timeout or 502 during submission is ambiguous: the upload may have reached Strava, so the client must ask the rider to check Strava before another submission. The desktop keeps its FIT and JSON files locally regardless of upload outcome.
