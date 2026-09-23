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
	 * Validate a session token and return the joined view a consumer needs to
	 * render an authenticated request: user, roles, session expiry, current
	 * vNAS controlling session and current filed flight plan.
	 *
	 * Returns `null` for unknown, expired, or invalidated tokens. Applies the
	 * sliding-refresh rule to the session.
	 */
	getSessionContext(token: string): Promise<SessionContext | null>;

	/** Invalidate a session token. No-op for unknown tokens. */
	logout(token: string): Promise<void>;
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
