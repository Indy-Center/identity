# identity

Centralized identity Worker for `*.flyindycenter.com`. Wraps VATSIM Connect OAuth, mints session cookies on `.flyindycenter.com`, exposes typed RPC over Cloudflare service bindings.

[![Tests and Verification](https://github.com/Indy-Center/identity/actions/workflows/ci.yml/badge.svg)](https://github.com/Indy-Center/identity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## HTTP surface

- `GET /login?return_url=…` starts the OAuth flow (browser).
- `GET /login/callback?code=…&state=…` is the OAuth callback from VATSIM (browser).
- `GET /healthz` is the liveness check.

Session validation, role management, profile updates, and logout all go over **RPC**, not HTTP. Consumer Workers call `env.IDENTITY.validateSession(token)`, `env.IDENTITY.invalidateSession(token)`, etc.

> **Why no HTTP surface for those?** RPC over service bindings is in-process — no network round trip, no JSON serialization, no CORS, typed errors propagating cleanly. For Workers consuming identity, that's strictly better than HTTP. We've considered adding a thin HTTP layer (e.g. `GET /api/me`, `POST /api/logout`) wrapping the same internal functions the RPC methods use, and it's the right answer the moment a non-Worker consumer shows up — browser-only static site, mobile app, third-party tool — but until then we stay RPC-only. If you need this, see the deferred-option note in `WIKI_APP_DESIGN.md`.

## Project layout

- `src/users/`, `src/sessions/`, `src/roles/`: domain modules. Plain async functions over a Drizzle `DB`. `src/index.ts` delegates RPC methods straight to these.
- `src/client/`: the consumer-facing surface. Types (`User`, `SessionPayload`, `AttributePatch`, `VatsimProfile`), the `IdentityRpc` interface, and `IdentityError`. Other Workers import from here so they only see the public contract, not the implementation.
- `src/migrations/`: D1 migrations, applied automatically on deploy.

## Local development

```bash
npm install
npm run db:migrate:local   # apply D1 migrations to the local sqlite
npm run dev                # wrangler dev on http://localhost:8787
npm test                   # vitest with workers pool
npm run cf-typegen         # regenerate worker-configuration.d.ts after wrangler.jsonc changes
```

For OAuth testing locally, register a VATSIM Connect dev client with redirect URI `http://localhost:8787/login/callback`, then copy `.dev.vars.example` to `.dev.vars` and fill in the credentials.

When `COOKIE_DOMAIN=localhost`, identity also accepts loopback `return_url` values (`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`) so dev consumer apps can complete the OAuth flow against the local worker. Production stays strict.

If the local D1 gets tangled up:

```bash
npx wrangler d1 delete identity_db
npx wrangler d1 create identity_db
# Copy the new database_id into wrangler.jsonc
npm run db:migrate:local
```

## Tests

```bash
npm test
npm run typecheck
```

## Deployment

Pushing to `main` triggers `.github/workflows/build-and-deploy.yml`, which applies pending D1 migrations and then deploys the Worker. Requires a `CLOUDFLARE_WORKERS_API_KEY` repository secret with `Workers Scripts:Edit` and `D1:Edit` permissions.

One-time setup per environment:

```bash
wrangler d1 create identity_db
# copy the database_id into wrangler.jsonc
wrangler secret put CONNECT_CLIENT_ID
wrangler secret put CONNECT_CLIENT_SECRET
```

## Consumer apps

Other Workers consume identity via a service binding. In their `wrangler.jsonc`:

```jsonc
"services": [
  { "binding": "IDENTITY", "service": "identity" }
]
```

Type the binding against `IdentityRpc` (from `src/client/api.ts`) so consumers only see the public surface:

```ts
import type { IdentityRpc } from './identity-client';

type Env = {
	IDENTITY: Service<IdentityRpc>;
};

const session = await env.IDENTITY.validateSession(cookieToken);
if (!session) return new Response('unauthorized', { status: 401 });
// session.userId is the canonical UUID; session.roles is string[]
const user = await env.IDENTITY.getUserById(session.userId);
```

## Disclaimer

We are not affiliated with the FAA or any aviation governing body. This software is for flight simulation use on the [VATSIM](https://www.vatsim.net) network.
