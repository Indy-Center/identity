import { OAuth2Client } from 'arctic';
import type { Env } from '../env';

export const VATSIM_SCOPES = ['full_name', 'vatsim_details', 'email'];

export function buildVatsimClient(env: Env): OAuth2Client {
	return new OAuth2Client(
		env.CONNECT_CLIENT_ID,
		env.CONNECT_CLIENT_SECRET,
		env.CONNECT_CALLBACK_URL
	);
}

export function buildAuthorizationUrl(env: Env, state: string): URL {
	const client = buildVatsimClient(env);
	return client.createAuthorizationURL(
		`${env.CONNECT_BASE_URL}/oauth/authorize`,
		state,
		VATSIM_SCOPES
	);
}

export async function exchangeCodeForToken(env: Env, code: string): Promise<string> {
	const client = buildVatsimClient(env);
	const tokens = await client.validateAuthorizationCode(
		`${env.CONNECT_BASE_URL}/oauth/token`,
		code,
		null
	);
	return tokens.accessToken();
}
