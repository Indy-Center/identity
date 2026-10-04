// Every HTTP-visible failure outside /oauth/* (which uses RFC 6749 errors).
export type ErrorCode =
	| 'not_found'
	| 'validation_failed'
	| 'invalid_state'
	| 'oauth_exchange_failed'
	| 'vatsim_profile_failed'
	| 'invalid_return_url'
	| 'unauthenticated'
	| 'access_denied'
	| 'insufficient_scope'
	| 'conflict'
	| 'internal';

export class IdentityError extends Error {
	constructor(
		public readonly code: ErrorCode,
		public readonly status: number,
		message?: string
	) {
		super(message ?? code);
		this.name = 'IdentityError';
	}
}
