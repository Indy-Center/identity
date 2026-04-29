const SESSION_COOKIE_NAME = 'fic_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30d
const HOST_STATE_MAX_AGE_SECONDS = 600; // 10m

export function buildSessionSetCookie(token: string, domain: string): string {
	return [
		`${SESSION_COOKIE_NAME}=${token}`,
		`Domain=${domain}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
		`Max-Age=${SESSION_MAX_AGE_SECONDS}`
	].join('; ');
}

export function buildSessionClearCookie(domain: string): string {
	return [
		`${SESSION_COOKIE_NAME}=`,
		`Domain=${domain}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
		'Max-Age=0'
	].join('; ');
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
