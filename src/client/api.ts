// src/client/api.ts
import type { SessionContext } from './session-context';

/**
 * Public RPC surface of the identity worker, version 1.0.0.
 *
 * Future minor versions add methods here as consumers need them. The worker
 * class (`Identity` in `src/index.ts`) may have additional methods that aren't
 * yet exposed in this interface; those are callable at runtime but not visible
 * to typed consumers, by design.
 */
export interface IdentityRpc extends Rpc.WorkerEntrypointBranded {
	/**
	 * Validate a session token and return the joined view a consumer typically
	 * needs to render an authenticated request: the user record, the user's
	 * role grants, the session's expiry, and the user's current vNAS controlling
	 * session (or `null` if not currently online).
	 *
	 * Returns `null` for unknown, expired, or invalidated tokens.
	 *
	 * The active-session lookup is backed by an in-memory snapshot of the public
	 * vNAS controllers feed with a 15-second TTL and singleflight; it adds at
	 * most one upstream HTTP fetch per isolate per 15 seconds, and degrades to
	 * `null` when the feed is unavailable.
	 */
	getSessionContext(token: string): Promise<SessionContext | null>;
}

/**
 * Convenience type for the Cloudflare service-binding declaration. Consumers
 * write `IDENTITY: IdentityBinding` in their `Env` rather than repeating the
 * `Service<IdentityRpc>` wrapping.
 *
 * Note: `Service<>` is a global ambient type provided by `@cloudflare/workers-types`.
 * Consumers must have that package available (directly or transitively, e.g.
 * via SvelteKit's Cloudflare adapter).
 */
export type IdentityBinding = Service<IdentityRpc>;
