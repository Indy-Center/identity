export type ErrorCode =
	| 'unauthenticated'
	| 'invalid_state'
	| 'oauth_exchange_failed'
	| 'vatsim_profile_failed'
	| 'invalid_return_url'
	| 'access_denied'
	| 'internal';

export class AppError extends Error {
	constructor(
		public readonly code: ErrorCode,
		public readonly status: number,
		message?: string
	) {
		super(message ?? code);
		this.name = 'AppError';
	}
}
