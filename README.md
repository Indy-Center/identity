# identity

Centralized identity Worker for `*.flyindycenter.com`. Wraps VATSIM Connect OAuth, mints session cookies on `.flyindycenter.com`, exposes typed RPC over Cloudflare service bindings.

See `docs/specs/2026-04-26-identity-design.md` for the full design.

## HTTP surface

- `GET /login?return_url=…` — start OAuth (browser).
- `GET /login/callback?code=…&state=…` — OAuth callback from VATSIM (browser).
- `GET /healthz` — liveness check.

That's it. Session validation, role management, profile updates, and logout are all over **RPC**, not HTTP. Consumer Workers call `env.IDENTITY.validateSession(token)`, `env.IDENTITY.invalidateSession(token)`, etc.

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev
```

The dev Worker listens on `http://localhost:8787`. For OAuth testing locally, register a VATSIM Connect dev client with redirect URI `http://localhost:8787/login/callback` and put credentials in `.dev.vars` (gitignored):

```
CONNECT_CLIENT_ID=...
CONNECT_CLIENT_SECRET=...
CONNECT_BASE_URL=https://auth-dev.vatsim.net
CONNECT_CALLBACK_URL=http://localhost:8787/login/callback
COOKIE_DOMAIN=localhost
```

## Tests

```bash
npm test            # vitest with workers pool — real D1, real bindings
npm run typecheck
```

Tests use `@cloudflare/vitest-pool-workers`; D1 migrations are applied automatically before each suite via `test/helpers/apply-migrations.ts`. The test pool also exposes `env.IDENTITY` (a self-service-binding) so RPC methods can be invoked directly from test code.

## Deployment

One-time setup:

```bash
wrangler d1 create identity_db
# → copy the database_id into wrangler.jsonc
wrangler secret put CONNECT_CLIENT_ID
wrangler secret put CONNECT_CLIENT_SECRET
```

Routine deploys:

```bash
npm run db:generate                                  # if schema changed
wrangler d1 migrations apply identity_db --remote
npm run deploy
```

Add the route in `wrangler.jsonc` (or via the dashboard) so the Worker handles `auth.flyindycenter.com/*`:

```jsonc
"routes": [
  { "pattern": "auth.flyindycenter.com/*", "custom_domain": true }
]
```

## Consumer apps

Other Workers consume identity via a service binding. In their `wrangler.jsonc` (or `wrangler.toml`):

```jsonc
"services": [
  { "binding": "IDENTITY", "service": "identity" }
]
```

Then in code:

```ts
const session = await env.IDENTITY.validateSession(cookieToken);
if (!session) return new Response('unauthorized', { status: 401 });
// session.userId is the canonical UUID; session.roles is string[]
// fetch the full user profile separately when needed:
const user = await env.IDENTITY.getUserById(session.userId);
```

See the `IdentityRpc` interface in `docs/specs/2026-04-26-identity-design.md` §"RPC API" for the full method list.

## User migration

Identity has no bulk migration script. Users from community-website are migrated **lazily on login** — `upsertFromVatsim` either matches an existing row by CID or creates a fresh one. Consumer apps that previously held user data are responsible for bridging their legacy IDs to identity's UUIDs (typically via CID lookup) when their data references users.
