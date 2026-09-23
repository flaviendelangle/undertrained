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

Desktop sessions currently grant profile access only and are not accepted by the existing tRPC context. Future native APIs must authenticate these sessions and check athlete ownership explicitly.

Codes and session tokens are stored only as hashes. The existing account deletion cascade removes their rows. Schedule routine cleanup of expired rows:

```sql
DELETE FROM desktop_codes WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
DELETE FROM desktop_sessions WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
```

The browser confirmation form carries an HMAC over the athlete, redirect, state, challenge and expiry. The callback is restricted to `http://127.0.0.1:PORT/callback` on an unprivileged port. PKCE protects the intercepted-code case, and code consumption is a transactional delete, preventing replay across server instances.

Validation performed: authentication helper tests, TypeScript checking, and ESLint on changed application files. Browser approval through an actual Strava account and a migrated database must be checked after deploying this prerequisite.
