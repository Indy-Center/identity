export type ErrorCode =
	| 'not_found'
	| 'validation_failed'
	| 'invalid_state'
	| 'oauth_exchange_failed'
	| 'vatsim_profile_failed'
	| 'invalid_return_url'
	| 'unauthenticated'
	| 'access_denied'
	| 'internal';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	not_found: 404,
	validation_failed: 400,
	invalid_state: 400,
	oauth_exchange_failed: 502,
	vatsim_profile_failed: 502,
	invalid_return_url: 400,
	unauthenticated: 401,
	access_denied: 403,
	internal: 500
};

// Encode the code in `name` (e.g. "IdentityError:not_found") so it survives
// the service-binding wire — Workers RPC retains an Error's `name` and
// `message` but strips own properties (so `this.code` and `this.status` are
// lost on the consumer side).
// https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/
export class IdentityError extends Error {
	constructor(
		public readonly code: ErrorCode,
		public readonly status: number,
		message?: string
	) {
		super(message ?? code);
		this.name = `IdentityError:${code}`;
	}
}

export function isIdentityError(e: unknown): boolean {
	if (e instanceof IdentityError) {
		return true;
	}
	if (e == null || typeof e !== 'object') {
		return false;
	}
	const name = (e as { name?: unknown }).name;
	return typeof name === 'string' && name.startsWith('IdentityError:');
}

export function getIdentityErrorCode(e: unknown): ErrorCode | null {
	if (e instanceof IdentityError) {
		return e.code;
	}
	if (e == null || typeof e !== 'object') {
		return null;
	}
	const name = (e as { name?: unknown }).name;
	if (typeof name !== 'string' || !name.startsWith('IdentityError:')) {
		return null;
	}
	return name.slice('IdentityError:'.length) as ErrorCode;
}

export function getStatusForCode(code: ErrorCode): number {
	return STATUS_BY_CODE[code];
}
