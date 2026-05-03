import type { User } from './user';
import type { AttributePatch } from './attributes';
import type { SessionPayload } from './session';

/**
 * User records, attribute updates, and the operating-initials utility.
 *
 * Consumers can type their service binding as `Service<IdentityUsers>` if
 * they only need this slice of the surface.
 */
export interface IdentityUsers {
	/** Look up a user by identity-issued id. Returns `null` if no match. */
	getUserById(id: string): Promise<User | null>;

	/** Look up a user by VATSIM cid. Returns `null` if no match. */
	getUserByCid(cid: string): Promise<User | null>;

	/**
	 * Look up users by email. Email is indexed but not unique at the DB level
	 * (VATSIM policy enforces, but two CIDs can share an inbox in edge cases),
	 * so this returns an array — usually length 0 or 1, occasionally more.
	 */
	getUserByEmail(email: string): Promise<User[]>;

	/** All users in the database. Intended for admin tooling. */
	listUsers(): Promise<User[]>;

	/** All users that hold the given role grant. */
	listUsersByRole(role: string): Promise<User[]>;

	/**
	 * Update consumer-managed attributes on a user. Applies JSON Merge Patch
	 * (RFC 7396) semantics:
	 *   - field absent or `undefined` → preserve existing value
	 *   - field is `null`             → delete the key from `attributes`
	 *   - field is a primitive/array  → set/overwrite
	 *   - field is an object          → RECURSIVELY merge with the existing
	 *                                   object at that key (full RFC 7396)
	 *
	 * Atomic: implemented as a single SQL UPDATE using SQLite's json_patch
	 * function, so concurrent calls cannot stomp each other's keys.
	 *
	 * Does not touch `vatsim_data` or any other identity-controlled columns.
	 * Validates the patch against `AttributePatchSchema` before writing.
	 *
	 * @throws `IdentityError('not_found', 404)` if `userId` is unknown.
	 * @throws `IdentityError('validation_failed')` if the patch fails schema validation.
	 */
	setAttributes(userId: string, patch: AttributePatch): Promise<User>;

	/**
	 * Toggle the user's `is_active` gate. Disabling synchronously invalidates
	 * all of the user's live sessions and writes `disabledReason`,
	 * `disabledAt`, and `disabledBy` into `attributes`. Re-enabling clears
	 * those keys.
	 *
	 * Disabled users are rejected at the OAuth callback with `access_denied`,
	 * so they cannot mint new sessions.
	 *
	 * @param opts.reason       Free-form reason stored in `attributes.disabledReason`.
	 * @param opts.changedBy    User id of the admin issuing the change, stored in `attributes.disabledBy`.
	 * @throws `IdentityError('not_found', 404)` if `userId` is unknown.
	 */
	setUserActive(
		userId: string,
		active: boolean,
		opts?: { reason?: string; changedBy?: string }
	): Promise<User>;

	/**
	 * The set of `operatingInitials` values currently in use across all users.
	 * Intended for client-side uniqueness checks when a user is generating
	 * (or picking) a new OI; not enforced at the DB level.
	 */
	listOperatingInitials(): Promise<string[]>;
}

/**
 * Session lifecycle — validate, fetch, invalidate.
 *
 * Sessions are minted only by the OAuth callback (`/login/callback`); there
 * is no `createSession` RPC method. Consumers read session state via
 * `validateSession` or `getCurrentUser`, and end sessions via
 * `invalidateSession` / `invalidateUserSessions`.
 */
export interface IdentitySessions {
	/**
	 * Validate a session token and return the lean payload (`userId`, `roles`,
	 * `expiresAt`). Returns `null` for unknown, expired, or invalidated tokens.
	 * On valid hits, refreshes `lastSeenAt` and may extend `expiresAt` if the
	 * session is within its refresh threshold.
	 */
	validateSession(token: string): Promise<SessionPayload | null>;

	/**
	 * Convenience: validate the session and fetch the full `User` in one call.
	 * Returns `null` if the token is unknown, expired, or no longer linked to
	 * a user. Use this when a consumer needs both auth and profile data on a
	 * single request — saves a round-trip vs. `validateSession` + `getUserById`.
	 */
	getCurrentUser(token: string): Promise<User | null>;

	/** Delete a single session by token. No-op if the token is unknown. */
	invalidateSession(token: string): Promise<void>;

	/**
	 * Delete every session belonging to a user. Used internally by
	 * `setUserActive` on disable, and available for explicit "log out
	 * everywhere" flows.
	 */
	invalidateUserSessions(userId: string): Promise<void>;
}

/**
 * Role grants. Roles are application-defined strings (e.g. `'zid:admin'`);
 * identity stores them but does not validate the role name. Each grant
 * records when it happened and (optionally) which user granted it.
 */
export interface IdentityRoles {
	/** Grant a role to a user. No-op if the user already holds the role. */
	addRole(userId: string, role: string, opts?: { grantedBy?: string }): Promise<void>;

	/** Revoke a single role from a user. No-op if the user doesn't hold it. */
	removeRole(userId: string, role: string): Promise<void>;

	/**
	 * Replace a user's full role set with the given list. Atomic: deletes all
	 * existing grants for the user, then inserts the new list. Pass `[]` to
	 * revoke everything.
	 */
	setRoles(userId: string, roles: string[], opts?: { grantedBy?: string }): Promise<void>;

	/** All role names currently granted to a user. Returns `[]` if none. */
	getRoles(userId: string): Promise<string[]>;
}

/**
 * The complete identity service RPC surface, composed of the three
 * domain-aligned sub-interfaces. The `Identity` worker class declares
 * `implements IdentityRpc`; TypeScript fails compile if the class drifts
 * from any sub-interface.
 *
 * Consumer workers usually type their service binding as `Service<IdentityRpc>`
 * for the full surface, or as one of the sub-interfaces (`IdentityUsers`,
 * `IdentitySessions`, `IdentityRoles`) when they only need a slice.
 *
 * Errors thrown from these methods cross the service-binding wire as plain
 * objects; consumers identify them via `isIdentityError(err)` and pull the
 * code via `getIdentityErrorCode(err)` (see `./errors`). The `instanceof`
 * check only works inside the identity worker itself.
 */
export interface IdentityRpc extends IdentityUsers, IdentitySessions, IdentityRoles {}
