// Type-checked by `npm run check:consumer` with `types: []`: what a Node or
// browser consumer sees with no Cloudflare ambient types in scope. Never run.
import {
	createIdentityClient,
	IdentityError,
	SESSION_COOKIE,
	sessionCookieOptions,
	type CompletedLogin,
	type SessionContext
} from '../../dist/index.js';

const identity = createIdentityClient();
const custom = createIdentityClient({
	baseUrl: 'http://localhost:8787',
	fetch: (input, init) => fetch(input, init),
	clientId: 'node-consumer'
});

export const withGlobalFetch = createIdentityClient({ fetch: globalThis.fetch });

export const loginHref: string = identity.loginUrl('http://localhost:3000/');
export const logoutHref: string = custom.logoutUrl('http://localhost:3000/');

export async function whoami(token: string): Promise<string | null> {
	try {
		const ctx: SessionContext | null = await identity.getSessionContext(token);
		return ctx?.user.cid ?? null;
	} catch (e) {
		if (e instanceof IdentityError && e.code === 'unauthenticated') {
			return null;
		}
		throw e;
	}
}

export async function finish(url: string): Promise<[string, string, Date] | null> {
	const login: CompletedLogin | null = await identity.completeLogin(url);
	if (!login) {
		return null;
	}
	const cookie = sessionCookieOptions({ expiresAt: login.expiresAt, secure: true });
	return [SESSION_COOKIE, login.redirectTo, cookie.expires];
}
