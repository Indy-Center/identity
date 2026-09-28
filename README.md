# id

Identity for `*.flyindycenter.com`: an OAuth 2.0 authorization server that brokers VATSIM Connect, plus a small API for users and roles.

- **Live:** https://id.flyindycenter.com
- **API reference:** https://id.flyindycenter.com/docs (OpenAPI at `/openapi.json`)

[![Tests and Verification](https://github.com/Indy-Center/identity/actions/workflows/ci.yml/badge.svg)](https://github.com/Indy-Center/identity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Log users in

Identity is plain OAuth 2.0 (authorization-code grant), so use any OAuth client. With [arctic](https://arcticjs.dev):

```ts
import { OAuth2Client, generateState } from 'arctic';

const ID = 'https://id.flyindycenter.com';
// First-party apps on *.flyindycenter.com or localhost need no registration:
// client_id is a label and there is no secret.
const oauth = new OAuth2Client('my-app', null, 'http://localhost:5173/auth/callback');

// 1. Send the browser to identity (store `state` in a short-lived cookie).
const state = generateState();
const url = oauth.createAuthorizationURL(`${ID}/oauth/authorize`, state, []);

// 2. On the callback, check state, then exchange the code.
const tokens = await oauth.validateAuthorizationCode(`${ID}/oauth/token`, code, null);

// 3. Who is it? `sub` is the VATSIM CID; `roles` are app:permission strings.
const me = await fetch(`${ID}/oauth/userinfo`, {
	headers: { Authorization: `Bearer ${tokens.accessToken()}` }
}).then((r) => r.json());
```

Keep the access token in your own session. Call `/oauth/userinfo` again whenever you need current roles. Logout and bans take effect immediately.

Send users to `https://id.flyindycenter.com/logout?return_url=…` to sign out everywhere.

Apps on other domains (Moodle, Wiki.js) must be **registered clients** with exact redirect URIs and a secret; see below.

## Call the API from a service

Services use the client-credentials grant (RFC 6749 §4.4). A registered client authenticates with `client_secret_basic` (as below) or `client_secret_post` (`client_id`/`client_secret` in the form body):

```bash
curl -u community:$SECRET -d grant_type=client_credentials https://id.flyindycenter.com/oauth/token
# → { "access_token": "…", "token_type": "Bearer", "expires_in": 3600, "scope": "users:read users:write" }
# a client with no granted scopes, or a scope request it can't satisfy, gets 400 invalid_scope

curl -H "Authorization: Bearer $TOKEN" https://id.flyindycenter.com/api/users/1234567
```

Roles are `app:permission` strings. `/api` request bodies must be `Content-Type: application/json`. Each client can only change the roles it granted, and can't add or remove `global:*` roles (see below):

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"add":["events:can_sign_up"],"remove":["community:admin"]}' \
  https://id.flyindycenter.com/api/users/1234567/roles
```

Everything else is at [/docs](https://id.flyindycenter.com/docs).

## Manage clients and admin roles

These commands need Cloudflare access, and run against production unless you pass `--local`:

```bash
npm run client -- create community --scope users:read --scope users:write
npm run client -- create moodle --redirect-uri https://moodle.flyindycenter.com/admin/oauth2callback.php
npm run client -- rotate community           # new secret; old tokens die immediately
npm run client -- delete community --yes     # --yes is required against the remote db
npm run client -- list
npm run role -- grant 1234567 global:admin   # global:* roles can only be granted/revoked here
npm run role -- revoke 1234567 global:admin
```

Notes:

- `create` needs at least one `--scope` or `--redirect-uri`, else the client could do nothing.
- Redirect URIs must be `https` (`http` only on `localhost`, `127.0.0.1` or `[::1]`), must not carry a fragment, and are matched **exactly** at `/oauth/authorize` — no prefix or wildcard matching.
- `rotate`, `delete` and `role revoke` fail loudly if nothing matched (unknown client id, or no such grant).
- The client id `cli` is reserved.
- The API refuses to add or remove any `global:` role from either client-credentials or user tokens; only `npm run role` can touch them.

## Security notes

A `users:write` token can't grant or revoke `global:*` roles, but it can disable any user — including admins — which immediately ends all of that user's sessions. If that locks out every admin, recover with `npm run role -- grant <cid> global:admin` on a working account, then re-enable the rest with `PATCH /api/users/:cid` (`{"active": true}`, from that account or another client with `users:write`) or directly against `id_db`.

## Working on identity

```bash
npm install
cp .dev.vars.example .dev.vars   # VATSIM Connect sandbox credentials
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

Register a sandbox client at `auth-dev.vatsim.net` with the redirect URI `http://localhost:8787/login/callback`. Reset the local database with `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local`.

```bash
npm test && npm run typecheck && npm run format:check
```

Pushing to `main` applies D1 migrations to `id_db` and deploys the `id` Worker.

Production needs the `CONNECT_CLIENT_ID` / `CONNECT_CLIENT_SECRET` secrets set on the `id` Worker: `npx wrangler secret put CONNECT_CLIENT_ID --name id` (and the same for `CONNECT_CLIENT_SECRET`).

## Migrating from auth.flyindycenter.com

The old `identity` Worker on `auth.flyindycenter.com` still serves apps using `@indy-center/identity@1.x`. That package is retired: move to the OAuth flow above, then the old Worker will be deleted.

## Disclaimer

We are not affiliated with the FAA or any aviation governing body. This software is for flight simulation use on the [VATSIM](https://www.vatsim.net) network.
