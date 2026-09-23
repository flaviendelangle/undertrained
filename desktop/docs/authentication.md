# Desktop authentication

The application is a public client. It contains no OAuth client secret and never receives the Strava access or refresh token.

1. Probe `GET /api/desktop/session`; an unauthenticated updated server responds with 401.
2. Bind an ephemeral TCP port on IPv4 loopback. Generate independent random 256-bit `state` and PKCE verifier values.
3. Open `/api/desktop/authorize?redirect_uri=http://127.0.0.1:PORT/callback&state=STATE&code_challenge=S256` in the system browser.
4. The backend requires its existing NextAuth session, using the existing Strava login if needed. A confirmation form binds the request, athlete and expiry with an HMAC signed by `NEXTAUTH_SECRET`.
5. After approval, the backend stores a hashed, 60-second code bound to the PKCE challenge and redirects to loopback.
6. The desktop validates the callback path and state, then posts `{code, code_verifier}` to `/api/desktop/token`.
7. The backend atomically consumes the matching code and returns `{access_token, expires_at, athlete: {id, name}}`.
8. The desktop stores its independent bearer session in the operating system keyring. Sessions expire after 30 days and are validated through `/api/desktop/session` on launch.
9. Sign-out removes the local credential and requests `DELETE /api/desktop/session` to revoke the server token.

The server stores only hashes of desktop bearer tokens. Code exchange has no client secret. Authorization codes cannot be used without the verifier, and the database delete prevents replay. Callback redirects are restricted to the exact `/callback` path on `127.0.0.1`, ports 1024–65535. Remote server connections require HTTPS; HTTP loopback supports development. HTTP redirects are disabled for native API requests.

The desktop session grants profile and read-only cycling workout access, plus explicit ride uploads to Strava through Undertrained. It is not accepted by existing tRPC routes. `GET /api/desktop/workouts` validates the bearer session and derives athlete ownership from it. The response contains personal cycling workouts and built-in workouts, including execution plans for guided playback. Requests time out after 15 seconds and do not follow redirects. The bearer-authenticated `POST /api/desktop/uploads` submits a FIT file, and `GET /api/desktop/uploads` checks its signed receipt. There is no refresh-token flow in this milestone.

Desktop authentication is in [backend PR #90](https://github.com/flaviendelangle/undertrained/pull/90). Workout access is in [backend PR #91](https://github.com/flaviendelangle/undertrained/pull/91). Deploy both changes to use the account library. Create and edit links open the server origin with `/workouts/new` or `/workouts/{id}`. They carry no desktop credential; the browser uses its own web session.

The server deployment should periodically delete expired rows from `desktop_codes` and `desktop_sessions`. Session storage failure leaves a session active only in memory and is reported in the UI. Sign-out while offline cannot guarantee server revocation and reports that limitation.
