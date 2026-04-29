---
status: proposed
date: 2026-04-26
authors: steve@ninjacat.io
amended: 2026-04-28
---

# auth.flyindycenter.com — Centralized Identity Service

> **Amendments (2026-04-28):** Service renamed from `auth-service` to `identity` (hostname `auth.flyindycenter.com` unchanged). Service binding is now `IDENTITY` (was `AUTH`). HTTP surface narrowed to `/login`, `/login/callback`, `/healthz` only — `/api/session` and `POST /logout` dropped because the only consumer (community-website) is a Worker that uses RPC. CORS middleware dropped along with `/api/*`. `validateSession` now returns lean `{userId, roles}`; consumers call `getUserById` separately when they need profile data. Per-app `user_metadata` table + `setMetadata`/`getMetadata`/`deleteMetadata` RPC dropped from v1 (no consumer needs it; community-website's app-specific data lives in its own `member_profiles` table). All amendments are reflected inline below.

## Summary

Stand up a single Cloudflare Worker at `auth.flyindycenter.com` that wraps VATSIM Connect OAuth and serves as the identity provider for all `*.flyindycenter.com` apps. Apps share a parent-domain session cookie and consume identity data via Cloudflare service bindings (typed RPC). Identity owns the canonical user row, the session lifecycle, and per-app role grants. ARTCC-specific business logic (membership tiers, certifications, operating initials, VATUSA role mapping) stays in community-website.

## Goals

- Single sign-on across `*.flyindycenter.com` (community-website, future controller-tools, future apps).
- Authoritative store of user identity (CID, name, email, plus extensible profile fields like `discord_id`).
- Per-app role grants, queryable via typed RPC.
- Extract the generic auth code from community-website without dragging along ARTCC-specific business logic.
- Keep the implementation small enough to fit in a single Worker.

## Non-goals

- OIDC / standards-compliant identity provider. Consumers are first-party Workers; service bindings beat OIDC for this use case.
- Cross-domain SSO (apps on non-`flyindycenter.com` domains). If we ever need that, OIDC is a future addition, not v1.
- A roster management UI. The ZID controller roster stays in community-website's D1; auth never knows about ARTCC membership.
- Replacing VATSIM Connect. VATSIM Connect remains the only identity source.

## Key decisions

| Decision | Choice |
|---|---|
| Scope of identity service | **Identity provider** — owns canonical user row + sessions; consumers store app-specific roles via the identity API. |
| Session model | Parent-domain cookie + `validateSession` RPC. Workers are the only consumers. |
| Roles model | Flat `string[]` with naming convention `scope:permission`. |
| User identifier | Generated UUID (PK) + `cid` (unique secondary). Existing community-website UUIDs preserved on migration. |
| Service-to-service auth | Cloudflare service bindings; single Worker via `WorkerEntrypoint` exposing `fetch()` (OAuth flow only) and RPC methods (binding-only). |
| HTTP framework | Hono. |
| Storage | Cloudflare D1 + Drizzle. |
| OAuth client | Arctic. |
| HTTP surface | `/login`, `/login/callback`, `/healthz`. (No `/api/session`, no `POST /logout` — consumers use RPC.) |
| Cookie naming | `fic_session` on `.flyindycenter.com`; `__Host-oauth_state` and `__Host-oauth_return` for the OAuth dance. |
| Membership sync trigger | Lazy-on-validation in community-website (`ctx.waitUntil`); auth doesn't know about it. |
| Migration cutover | One-shot data migration; users re-login once; cookie name change prevents transparent carryover. |
| Generator | `npm create hono@latest` with `cloudflare-workers` template. |
| Code style | Inherit community-website's Prettier config (minus Svelte-specific bits). |

## Architecture

```
                                ┌──────────────────────────────────────────────┐
                                │           auth.flyindycenter.com             │
                                │   (single CF Worker, Hono + WorkerEntrypoint)│
                                │                                              │
   browser  ──cookie──────────► │  fetch():                                    │
   (any *.flyindycenter.com)    │    GET  /login                               │
                                │    GET  /login/callback                      │
                                │    GET  /healthz                             │
                                │                                              │
   community-website Worker ──► │  RPC (service binding):                      │
   controller-tools  Worker ──► │    getUserById / getUserByCid                │
                                │    listUsersByRole                           │
                                │    addRole / removeRole / setRoles / getRoles│
                                │    updateProfile                             │
                                │    validateSession                           │
                                │    invalidateSession / invalidateUserSessions│
                                └─────────────────┬────────────────────────────┘
                                                  │
                                                  ▼
                                       ┌──────────────────┐
                                       │   D1 (identity_db)   │
                                       │  users           │
                                       │  sessions        │
                                       │  user_roles      │
                                       └──────────────────┘
```

The `WorkerEntrypoint` class exposes both an HTTP `fetch()` handler and arbitrary RPC methods. The `fetch()` handler is the only thing reachable via the public route `auth.flyindycenter.com/*`; the RPC methods are reachable only through service bindings declared by other Workers on the same Cloudflare account ([CF service bindings docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)).

## Data model

All timestamps are unix milliseconds (`INTEGER`). All FKs cascade-delete from `users`.

```sql
-- Identity. Synced from VATSIM Connect on each login + extensible profile fields.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,          -- UUID; preserved from community-website on migration
  cid             TEXT NOT NULL UNIQUE,      -- VATSIM CID, the natural OAuth key
  email           TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  preferred_name  TEXT,
  pronouns        TEXT,
  discord_id      TEXT,                      -- nullable; future Discord linking flow
  vatsim_data     TEXT NOT NULL,             -- JSON: full VATSIM profile cache
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_users_cid ON users(cid);

-- Sessions. id = hex(sha256(token)); raw token only ever lives in the cookie.
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Flat role list. Convention: "scope:permission" e.g. "zid:controller", "events:manage".
CREATE TABLE user_roles (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  granted_at      INTEGER NOT NULL,
  granted_by      TEXT,                      -- optional audit string from RPC caller
  PRIMARY KEY (user_id, role)
);

```

### Schema notes

- **UUIDs preserved on migration**, so existing FKs in community-website continue to resolve.
- **`vatsim_data` as JSON** — same shape as community-website's existing `usersTable.data`. We keep a denormalized cache so apps don't have to call VATSIM.
- **Profile fields hoisted to columns** (email, names, pronouns, `discord_id`) — these are the things we'll query/index. `vatsim_data` stays as raw cache for everything else.
- **Roles are flat strings**; the `granted_by` column is for audit (who/what RPC called `addRole`) — useful when debugging "why does this user have admin?"
- **Sessions store hashed token**, never raw — same pattern as today.
- **No refresh tokens stored.** VATSIM issues short-lived access tokens but we don't need them after the initial profile fetch. The user re-logs-in eventually, and we re-fetch then.

## Public HTTP API

| Method | Path | Purpose | Response |
|---|---|---|---|
| `GET` | `/login?return_url=…` | Start OAuth. Sets `__Host-oauth_state` + optional `__Host-oauth_return` cookies. Redirects to VATSIM. | `302` |
| `GET` | `/login/callback?code=…&state=…` | Validate state, exchange code, upsert user, mint session cookie, redirect. | `302` |
| `GET` | `/healthz` | Liveness check. | `200` |

### Conventions

- Success responses redirect (`302`) for OAuth endpoints. Error responses return `{ error: { code, message } }` with appropriate HTTP status. Codes are stable strings: `invalid_state`, `oauth_exchange_failed`, `vatsim_profile_failed`, `invalid_return_url`, `internal`, etc.
- `return_url` is validated against `*.flyindycenter.com` to prevent open-redirect.
- Logout is handled by consumer apps, not by the identity service. Each consumer's `/logout` reads the `fic_session` cookie, calls `env.IDENTITY.invalidateSession(token)` via RPC, sets `Set-Cookie: fic_session=; Domain=.flyindycenter.com; Max-Age=0`, and redirects. The cookie is parent-domain scoped, so any subdomain Worker can clear it.

### Cookies

| Cookie | Domain | Attributes | Purpose |
|---|---|---|---|
| `fic_session` | `.flyindycenter.com` | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30d) | Session token. Readable by any `*.flyindycenter.com` Worker. |
| `__Host-oauth_state` | host-only on `auth.flyindycenter.com` | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` | CSRF state for OAuth. The `__Host-` prefix forbids `Domain` and requires `Secure`+`Path=/`. |
| `__Host-oauth_return` | host-only on `auth.flyindycenter.com` | same as above | Optional post-login redirect target. |

`SameSite=Lax` (not `Strict`) so the cookie is sent on the cross-site redirect back from VATSIM. Lax sends on top-level GET navigations, which is exactly the OAuth callback shape.

## RPC API

```ts
// Methods exposed on the WorkerEntrypoint, callable via env.IDENTITY.method(...)
// from any Worker on the same Cloudflare account that declares the binding.

interface IdentityRpc {
  // ── Session validation (the hot path for consumer Workers) ─────────────
  /** Validates a raw session token; returns lean {userId, roles}, or null. */
  validateSession(token: string): Promise<SessionPayload | null>;
  /** Invalidate a single session by its raw token. Used by consumer apps' /logout. */
  invalidateSession(token: string): Promise<void>;
  /** Force-logout all of a user's sessions. Use after revoking sensitive roles. */
  invalidateUserSessions(userId: string): Promise<void>;

  // ── User lookup ────────────────────────────────────────────────────────
  getUserById(id: string): Promise<User | null>;
  getUserByCid(cid: string): Promise<User | null>;
  listUsersByRole(role: string): Promise<User[]>;

  // ── Roles ──────────────────────────────────────────────────────────────
  addRole(userId: string, role: string, opts?: { grantedBy?: string }): Promise<void>;
  removeRole(userId: string, role: string): Promise<void>;
  setRoles(userId: string, roles: string[], opts?: { grantedBy?: string }): Promise<void>;
  getRoles(userId: string): Promise<string[]>;

  // ── Profile mutation ───────────────────────────────────────────────────
  updateProfile(userId: string, patch: Partial<UserProfile>): Promise<User>;
}

type SessionPayload = {
  userId: string;
  roles: string[];
};
```

### Conventions

- Methods named as verbs/verb-noun, not REST-style. They're typed function calls, not HTTP.
- `validateSession` returns the lean `{userId, roles}` payload. Consumers that need user profile data (name, email, vatsim cache) call `getUserById(userId)` separately. Service binding RPC is sub-millisecond, so the second call is essentially free, and most auth checks (permission gates on API routes) don't need the full profile.
- Mutations return `void` or the updated entity; lookups return the entity or `null`.
- `null` over throwing for "not found"; exceptions are reserved for genuine failures (D1 down, integrity violations).
- `grantedBy` is an optional audit string the caller chooses (e.g. `"community-website:vatusa-sync"`), recorded in `user_roles.granted_by`.

### Why no HTTP session endpoint?

The identity service has no `/api/session` HTTP endpoint and no CORS middleware. The only consumer (community-website, and future Workers like controller-tools) is itself a Cloudflare Worker that calls `env.IDENTITY.validateSession(token)` over a service binding — sub-millisecond, no HTTP, no JSON parse. If a non-Worker consumer (browser SPA, third-party app) ever appears, we add an HTTP endpoint then.

## OAuth flow

```
Browser              auth.flyindycenter.com           connect.vatsim.net          D1
  │                          │                                │                    │
  │  GET /login?return=...   │                                │                    │
  ├─────────────────────────►│                                │                    │
  │                          │ generate state (20B random)    │                    │
  │                          │ set __Host-oauth_state cookie  │                    │
  │                          │ set __Host-oauth_return cookie │                    │
  │  302 → vatsim authorize  │                                │                    │
  │◄─────────────────────────┤                                │                    │
  │                                                           │                    │
  │  user authorizes…                                         │                    │
  │                                                           │                    │
  │  302 → /login/callback?code=...&state=...                 │                    │
  │                          │                                │                    │
  │  GET /login/callback     │                                │                    │
  ├─────────────────────────►│                                │                    │
  │                          │ verify state cookie === query  │                    │
  │                          │ exchange code (Arctic)         │                    │
  │                          ├───────────────────────────────►│                    │
  │                          │ access_token                   │                    │
  │                          │◄───────────────────────────────┤                    │
  │                          │ GET /api/user (Bearer token)   │                    │
  │                          ├───────────────────────────────►│                    │
  │                          │ vatsim profile                 │                    │
  │                          │◄───────────────────────────────┤                    │
  │                          │ upsert user (by cid)           │                    │
  │                          ├────────────────────────────────────────────────────►│
  │                          │ generate session token         │                    │
  │                          │ insert sessions row            │                    │
  │                          ├────────────────────────────────────────────────────►│
  │                          │ set fic_session cookie         │                    │
  │  302 → return_url        │                                │                    │
  │◄─────────────────────────┤                                │                    │
```

Scopes requested from VATSIM Connect: `['full_name', 'vatsim_details', 'email']` (same as community-website today).

### Error handling

| Condition | Response |
|---|---|
| State cookie missing/mismatch | `400` + `{ error: { code: "invalid_state" } }`. Don't redirect — possible CSRF. |
| Code exchange fails | `502` + `{ error: { code: "oauth_exchange_failed" } }`. Log Arctic error server-side. |
| VATSIM `/api/user` returns non-200 | `502` + `{ error: { code: "vatsim_profile_failed" } }`. |
| D1 write failure | `500` + `{ error: { code: "internal" } }`. Log full error. |
| User denies authorization at VATSIM | `302` to `return_url?auth_error=access_denied` so the consumer can show a friendly message. |

## Session lifecycle

### Token format

```ts
const token = bytesToBase32(crypto.getRandomValues(new Uint8Array(20)));  // ~32 chars
const id = hex(await crypto.subtle.digest('SHA-256', utf8(token)));
// Store: sessions(id, user_id, expires_at = now + 30d, created_at = now, last_seen_at = now)
// Cookie value: token   (raw token never touches D1)
```

The DB stores `sha256(token)` so a leaked DB dump doesn't yield usable session tokens.

### Sliding refresh policy (in `validateSession`)

- If `expires_at < now` → delete row, return `null` (treated as logged-out).
- If `expires_at < now + 15d` → bump `expires_at = now + 30d`, return updated payload.
- Always update `last_seen_at = now`.

The cookie `Max-Age` is set once at session creation and not refreshed; we always extend the DB row before it would have expired, so active users stay signed in indefinitely. Inactive users expire after 30 days of silence.

### User upsert (in `/login/callback`)

```ts
const existing = await db.select().from(users).where(eq(users.cid, vatsim.cid)).get();
if (existing) {
  await db.update(users).set({
    email: vatsim.email,
    firstName: vatsim.personal.name_first,
    lastName: vatsim.personal.name_last,
    vatsimData: JSON.stringify(vatsim),
    updatedAt: now,
  }).where(eq(users.id, existing.id));
  return existing.id;
} else {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id, cid: vatsim.cid,
    email: vatsim.email,
    firstName: vatsim.personal.name_first,
    lastName: vatsim.personal.name_last,
    vatsimData: JSON.stringify(vatsim),
    createdAt: now, updatedAt: now,
  });
  return id;
}
```

Auth never touches roles or metadata on login; those are managed entirely by consumer apps.

## Cross-app integration (lazy sync)

Community-website needs to run its existing `syncUserMembership()` logic when a user logs in (VATUSA role mapping, certifications, operating initials, controller status). Approach: **lazy sync on session validation**, not a push hook from auth.

```ts
// In community-website's hooks.server.ts, after env.IDENTITY.validateSession(cookie):
const profile = await db
  .select()
  .from(memberProfiles)
  .where(eq(memberProfiles.userId, session.user.id))
  .get();

const stale = !profile || (now - profile.lastSyncedAt) > FIFTEEN_MINUTES;
if (stale) {
  event.platform.context.waitUntil(
    syncUserMembership(session.user, env)  // pushes role changes via env.IDENTITY.setRoles()
  );
}
```

**Properties:**
- Auth is genuinely decoupled from consumers — auth doesn't know community-website exists.
- Login stays fast; sync happens async in `ctx.waitUntil()`.
- First page load post-login may have stale roles for ~1 second; subsequent loads are fresh.
- Self-healing: if sync fails or VATUSA is down, the user still logs in; sync retries on next request.
- The "user opens controller-tools first" case works naturally — controller-tools doesn't run sync at all (it doesn't care about ARTCC membership data); community-website runs sync only when the user visits it.

## Migration plan

### Phase 1 — stand up auth (decoupled from production)

1. Scaffold project with `npm create hono@latest identity` → select `cloudflare-workers` template.
2. Implement schema, routes, RPC methods, tests (see Project Structure below).
3. Register VATSIM Connect production client with redirect URI `https://auth.flyindycenter.com/login/callback`.
4. Deploy to `auth.flyindycenter.com`. Smoke-test `/healthz`. Manual login test against an empty DB to verify the OAuth round-trip.
5. Run data migration (export community-website D1 users → import to auth D1, preserving UUIDs).

### Phase 2 — community-website integration behind a flag

1. Add `[[services]] binding = "IDENTITY"` to community-website's `wrangler.toml`.
2. Add new `hooks.server.ts` path: validate via `env.IDENTITY.validateSession()`.
3. Add new login flow: `/login/connect` redirects to `auth.flyindycenter.com/login`.
4. Add lazy-sync hook (calls existing `syncUserMembership`, pushes results via `env.IDENTITY.setRoles`).
5. Gate everything behind `USE_IDENTITY_SERVICE` env flag; ship dark.
6. End-to-end manual test: a few staff CIDs log in, see correct roles, can use the site normally.

### Phase 3 — production cutover

1. Set `USE_IDENTITY_SERVICE=true` on community-website; deploy.
2. All existing sessions invalidate (cookie name changes from `session` to `fic_session`); users re-login once.
3. Announce planned re-login window to staff.

### Phase 4 — cleanup

1. Drop community-website's `usersTable` (kept slimmed `member_profiles`).
2. Drop `userSessionsTable`, `userRolesTable` (auth owns these now).
3. Delete `oauth.ts`, `session.ts`, old login routes.
4. Remove `USE_IDENTITY_SERVICE` flag.

### Data migration

D1 doesn't support cross-database joins, so migration is a small one-shot Node script (committed under `identity/scripts/migrate-from-community-website.ts`). It uses the Cloudflare D1 HTTP API (or `wrangler d1 export` / `execute`) to:

1. Export rows from community-website's `users` and `user_roles` tables into local JSON.
2. For each `user` row, insert into auth's `users` table — preserving the existing UUID `id` — mapping community-website's `data` column to auth's `vatsim_data`. Use `now()` for `created_at`/`updated_at`.
3. For each `user_roles` row, insert into auth's `user_roles` with `granted_at = now()` and `granted_by = 'migration:initial'`.
4. Print row-count summary: `users: N exported / N imported`, same for roles. Bail with non-zero exit if counts don't match.

Sessions are **not** migrated. Users re-login once.

### Community-website schema changes

```sql
-- Slim usersTable to ARTCC-specific fields, rename for clarity
CREATE TABLE member_profiles (
  user_id              TEXT PRIMARY KEY,         -- FK to auth.users.id (cross-DB; no enforcement)
  membership           TEXT NOT NULL,
  operating_initials   TEXT,
  last_synced_at       INTEGER NOT NULL DEFAULT 0
  -- plus whatever else syncUserMembership writes
);
DROP TABLE users;
DROP TABLE user_sessions;
DROP TABLE user_roles;
```

Anything that previously joined on `users` joins on `member_profiles` instead — same `user_id`. Profile fields (firstName, email, etc.) come from the auth session payload via `locals.user`, not from a join.

### Code changes in community-website

| File | Change |
|---|---|
| `wrangler.toml` | Add `[[services]] binding = "IDENTITY"` |
| `src/lib/server/oauth.ts` | **Delete.** |
| `src/lib/server/session.ts` | **Delete.** |
| `src/lib/server/vatsim/vatsimConnectClient.ts` | **Delete.** |
| `src/routes/login/connect/+server.ts` | Replace with redirect to `auth.flyindycenter.com/login?return_url=…` |
| `src/routes/login/connect/callback/+server.ts` | **Delete.** |
| `src/routes/logout/+server.ts` | Make `POST` only. Read `fic_session` cookie, call `env.IDENTITY.invalidateSession(token)` via RPC, clear the cookie locally (`Set-Cookie: fic_session=; Domain=.flyindycenter.com; Max-Age=0`), redirect to `/`. |
| `src/hooks.server.ts` | Replace session validation with `env.IDENTITY.validateSession(cookie)`; populate `locals.user` and `locals.roles` from response; run lazy `syncUserMembership` via `event.platform.context.waitUntil(...)` if stale. |
| `src/lib/server/membership.ts` | When granting/revoking roles, call `env.IDENTITY.setRoles(userId, computedRoles)` instead of writing to local DB. |
| `src/lib/db/schema/users.ts` | Replace with `member_profiles` schema. |
| `src/lib/db/schema/sessions.ts` | **Delete.** |
| `src/lib/db/schema/roles.ts` | **Delete.** |
| `src/lib/utils/permissions.ts` | Keep (still maps role strings to UI permissions). |

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Auth service down → no logins anywhere | Cloudflare Workers SLA; service is small enough to have very high uptime. Monitor `/healthz`. |
| Stale roles after lazy sync window | Acceptable; roles converge within seconds. Critical writes (grant admin) call `env.IDENTITY.setRoles` synchronously in the originating flow. |
| Migration drops user data on import | Pre-migration: full D1 export to local SQLite. Post-migration: row-count comparison + spot-check 5 known users (founder, staff, recent registrant, oldest user, edge-case user with non-ASCII chars). |
| VATSIM Connect prod client redirect URI change | Coordinate with VATSIM ahead of cutover; have rollback plan to point client back at community-website. |
| Service binding latency | Both Workers run in same Cloudflare datacenter; service binding is sub-millisecond. Not a concern. |

## Project structure

```
identity/
├── package.json
├── wrangler.toml                     # routes: auth.flyindycenter.com/*; D1 binding; secrets
├── tsconfig.json
├── drizzle.config.ts
├── .prettierrc
├── src/
│   ├── index.ts                      # WorkerEntrypoint export, composes Hono app
│   ├── env.ts                        # Env type (D1, secrets, vars)
│   ├── app.ts                        # Hono app construction + middleware composition
│   ├── routes/
│   │   ├── login.ts                  # GET /login, GET /login/callback
│   │   └── health.ts                 # GET /healthz
│   ├── rpc/                          # methods exposed on WorkerEntrypoint
│   │   ├── users.ts
│   │   ├── roles.ts
│   │   ├── sessions.ts
│   │   └── profile.ts
│   ├── domain/                       # framework-agnostic business logic
│   │   ├── oauth.ts                  # Arctic client config
│   │   ├── session.ts                # token gen, sha256, refresh policy
│   │   ├── users.ts                  # upsertFromVatsim
│   │   ├── cookies.ts                # session/state cookie helpers
│   │   └── vatsim.ts                 # fetchVatsimProfile
│   ├── db/
│   │   ├── schema.ts                 # Drizzle schema
│   │   ├── client.ts                 # drizzle(d1) wrapper
│   │   └── migrations/               # drizzle-kit output
│   ├── middleware/
│   │   ├── error.ts                  # uniform error → JSON responder
│   │   └── logger.ts
│   └── lib/
│       ├── errors.ts                 # AppError class + code/status mapping
│       ├── crypto.ts                 # randomBytes, sha256, base32
│       └── time.ts                   # now() (testable clock)
├── test/
│   ├── routes/
│   ├── rpc/
│   ├── domain/
│   └── helpers/
│       ├── env.ts
│       └── fixtures.ts
└── README.md
```

**Boundary discipline:** `domain/` knows nothing about Hono or Workers — pure functions taking a `db`, a clock, and randomness. `routes/` and `rpc/` are thin adapters. This makes the domain layer trivially unit-testable and lets us swap the framework later if we ever want to.

## Hono conventions

```ts
// src/app.ts
import { Hono } from 'hono';
import type { Env, AppVariables } from './env';
import { errorMiddleware } from './middleware/error';
import { loggerMiddleware } from './middleware/logger';
import { loginRoutes } from './routes/login';
import { healthRoutes } from './routes/health';

export function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

  app.use('*', loggerMiddleware);
  app.use('*', errorMiddleware);

  app.route('/login', loginRoutes);
  app.route('/healthz', healthRoutes);

  return app;
}
```

```ts
// src/index.ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import * as users from './rpc/users';
import * as roles from './rpc/roles';
import * as sessions from './rpc/sessions';
import * as profile from './rpc/profile';
import type { Env } from './env';

const app = buildApp();

export default class Identity extends WorkerEntrypoint<Env> {
  fetch(request: Request) {
    return app.fetch(request, this.env, this.ctx);
  }

  // RPC surface — thin delegations to the rpc/ modules with env injected
  getUserById(id: string)              { return users.getById(this.env, id); }
  getUserByCid(cid: string)            { return users.getByCid(this.env, cid); }
  listUsersByRole(role: string)        { return users.listByRole(this.env, role); }
  validateSession(token: string)         { return sessions.validate(this.env, token); }
  invalidateSession(token: string)       { return sessions.invalidate(this.env, token); }
  invalidateUserSessions(userId: string) { return sessions.invalidateAllForUser(this.env, userId); }
  addRole(userId: string, role: string, opts?: { grantedBy?: string }) {
                                         return roles.add(this.env, userId, role, opts); }
  removeRole(userId: string, role: string) { return roles.remove(this.env, userId, role); }
  setRoles(userId: string, list: string[], opts?: { grantedBy?: string }) {
                                         return roles.set(this.env, userId, list, opts); }
  getRoles(userId: string)             { return roles.get(this.env, userId); }
  updateProfile(userId: string, patch: Partial<UserProfile>) {
                                         return profile.update(this.env, userId, patch); }
}
```

### Best practices applied

- One `Hono` instance per route module (`loginRoutes`, etc.) composed via `app.route()`. Each file stays small and independently testable.
- Typed `Bindings` (env) and `Variables` (per-request context) on the `Hono<...>` generic.
- `@hono/zod-validator` for query/body validation. `return_url` validation rejects open-redirect attempts (only allow `*.flyindycenter.com`).
- Cookie reads/writes via `hono/cookie` helpers, never raw header manipulation.
- Errors thrown as `AppError(code, status)` and caught by `errorMiddleware` → uniform `{ error: { code, message } }` JSON.

### Compatibility requirements

- `compatibility_date >= 2024-04-03` (or include the `rpc` flag) for `WorkerEntrypoint` ([CF RPC docs](https://developers.cloudflare.com/workers/runtime-apis/rpc/)).
- Same-Cloudflare-account requirement for service bindings — community-website, controller-tools, and identity all live in the same account.

## Testing strategy

Stack: **Vitest + `@cloudflare/vitest-pool-workers`** (Cloudflare's official testing harness; runs tests inside the Workers runtime with real D1, real bindings, real `crypto`).

```
test/
├── domain/           # pure unit tests, no Workers runtime needed
│   ├── session.test.ts        # token gen, hash, refresh thresholds
│   ├── users.test.ts          # upsertFromVatsim insert vs update branches
│   ├── cookies.test.ts        # cookie attribute assertions
│   └── vatsim.test.ts         # mocked VATSIM profile fetch
├── routes/           # integration via app.fetch() in Workers pool
│   ├── login.test.ts          # state cookie set, redirect URL correct
│   └── callback.test.ts       # mocked VATSIM, full flow → session created
└── rpc/              # call entrypoint methods directly via SELF binding
    ├── users.test.ts
    ├── sessions.test.ts       # validate + invalidate paths
    ├── roles.test.ts
    └── profile.test.ts
```

### Coverage targets

- OAuth flow end-to-end with VATSIM Connect intercepted at the fetch layer.
- Session validation: valid, expired, refreshed, missing, malformed.
- All RPC methods, including idempotency (`addRole` twice = one row; `setRoles` replaces the full list).
- Cookie attributes (HttpOnly, Secure, SameSite, Domain, Max-Age) — assert the actual `Set-Cookie` header.
- CORS allowlist: `app.flyindycenter.com` allowed, `evil.com` denied.
- Error responses: every error code has a test that triggers it.

We don't test against real VATSIM Connect; dev-mode VATSIM is for manual smoke testing during local development.

## Local dev & CI

```bash
npm run dev           # wrangler dev — runs locally on http://localhost:8787
npm run db:generate   # drizzle-kit generate (schema → migration SQL)
npm run db:migrate    # wrangler d1 migrations apply identity_db --local
npm test              # vitest with workers pool
npm run typecheck     # tsc --noEmit
npm run deploy        # wrangler deploy
```

For local OAuth testing: register a VATSIM Connect dev client with redirect URI `http://localhost:8787/login/callback`. `auth-dev.vatsim.net` allows non-HTTPS callbacks for development.

### CI pipeline (GitHub Actions)

- On PR: `npm test` + `npm run typecheck` + `wrangler deploy --dry-run`.
- On push to `main`: `wrangler d1 migrations apply identity_db --remote` then `wrangler deploy`.
- Secrets (`CONNECT_CLIENT_ID`, `CONNECT_CLIENT_SECRET`) set via `wrangler secret put`, never committed.

### Environment variables / secrets

| Name | Type | Purpose |
|---|---|---|
| `CONNECT_CLIENT_ID` | secret | VATSIM Connect OAuth client ID |
| `CONNECT_CLIENT_SECRET` | secret | VATSIM Connect OAuth client secret |
| `CONNECT_BASE_URL` | var | `https://auth.vatsim.net` (prod) or `https://auth-dev.vatsim.net` (dev) |
| `CONNECT_CALLBACK_URL` | var | `https://auth.flyindycenter.com/login/callback` |
| `COOKIE_DOMAIN` | var | `.flyindycenter.com` (prod); `localhost` (dev) |
| `DB` | D1 binding | Auth database |

## Tooling & code style

### Generator

Scaffold via `npm create hono@latest identity` and select the `cloudflare-workers` template ([Hono CF Workers guide](https://hono.dev/docs/getting-started/cloudflare-workers)). Resulting layout already includes `package.json`, `src/index.ts`, `wrangler.toml`, `tsconfig.json`. Apply the project structure above on top.

### Prettier config

Inherit community-website's `.prettierrc`, dropping the Svelte-specific entries:

```json
{
	"useTabs": true,
	"singleQuote": true,
	"trailingComma": "none",
	"printWidth": 100
}
```

`prettier-plugin-svelte` and `prettier-plugin-tailwindcss` are dropped — auth service has no Svelte and no Tailwind.

## Open questions / future work

- **Admin UI** at `auth.flyindycenter.com/admin` for inspecting users / roles / sessions. Not in v1.
- **Audit log table** (separate from `granted_by` column on `user_roles`) for tracking who/when granted/revoked. Probably yes when we have more apps writing roles, but not v1.
- **Discord linking flow** — a `/link/discord` route that prompts a user to authorize a Discord OAuth app and writes `users.discord_id`. Not v1.
- **OIDC layer** if we ever need to authenticate apps on non-`flyindycenter.com` domains or third-party apps. Additive on top of the existing service; not v1.
- **Per-app metadata bag** (`user_metadata` table + `setMetadata`/`getMetadata`/`deleteMetadata` RPC). Deferred from v1 — no consumer needs per-app session-bundled state today; community-website's app-specific data lives in its own `member_profiles` table. Add when an app actually needs it.
- **`GET /api/session` HTTP endpoint** + CORS for `*.flyindycenter.com`. Deferred from v1 — the only consumer is a Worker that uses RPC. Add the HTTP endpoint when a non-Worker consumer (browser SPA, third-party app) appears.
- **`POST /logout` HTTP endpoint.** Deferred from v1 — consumer apps handle their own logout via RPC + cookie clearing. Add a centralized HTTP logout if a use case emerges (e.g., a "log out everywhere" link from auth.flyindycenter.com).
- **Rich `validateSession` payload variant.** `validateSession` returns lean `{userId, roles}`; consumers call `getUserById` separately when they need profile data. If a hot path emerges where most calls need the full profile, consider adding a `validateSessionWithProfile` variant.
