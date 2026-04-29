const SESSION_COOKIE_NAME = 'fic_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30d
const HOST_STATE_MAX_AGE_SECONDS = 600; // 10m

export type SessionCookieOpts = {
	// `null` means emit the cookie as host-only (no Domain attribute) — used for localhost dev.
	domain: string | null;
	// `false` skips the `Secure` attribute — required for plain http://localhost dev.
	secure: boolean;
};

function joinAttrs(parts: Array<string | null>): string {
	return parts.filter((p): p is string => p !== null).join('; ');
}

export function buildSessionSetCookie(token: string, opts: SessionCookieOpts): string {
	return joinAttrs([
		`${SESSION_COOKIE_NAME}=${token}`,
		opts.domain ? `Domain=${opts.domain}` : null,
		'Path=/',
		'HttpOnly',
		opts.secure ? 'Secure' : null,
		'SameSite=Lax',
		`Max-Age=${SESSION_MAX_AGE_SECONDS}`
	]);
}

export function buildSessionClearCookie(opts: SessionCookieOpts): string {
	return joinAttrs([
		`${SESSION_COOKIE_NAME}=`,
		opts.domain ? `Domain=${opts.domain}` : null,
		'Path=/',
		'HttpOnly',
		opts.secure ? 'Secure' : null,
		'SameSite=Lax',
		'Max-Age=0'
	]);
}

export function buildHostStateSetCookie(
	name: 'oauth_state' | 'oauth_return',
	value: string
): string {
	return [
		`__Host-${name}=${value}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
		`Max-Age=${HOST_STATE_MAX_AGE_SECONDS}`
	].join('; ');
}

export function buildHostStateClearCookie(name: 'oauth_state' | 'oauth_return'): string {
	return [`__Host-${name}=`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=0'].join(
		'; '
	);
}

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
export const HOST_STATE_COOKIE = (name: 'oauth_state' | 'oauth_return') =>
	`__Host-${name}` as const;
