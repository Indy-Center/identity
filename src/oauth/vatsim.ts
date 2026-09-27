import { OAuth2Client } from 'arctic';
import { z } from 'zod';
import { IdentityError } from '../errors';

// Shape of the VATSIM /api/user OAuth payload — the chunk we store as
// users.vatsim_profile. Full reference:
// https://vatsim.dev/api/connect-api/get-user

const RatingSchema = z.looseObject({
	id: z.number().optional(),
	short: z.string().optional(),
	long: z.string().optional()
});

const GeoRefSchema = z.looseObject({
	id: z.string().nullable().optional(),
	name: z.string().nullable().optional()
});

export const VatsimProfileSchema = z.looseObject({
	cid: z.string(),
	personal: z.looseObject({
		name_first: z.string().optional(),
		name_last: z.string().optional(),
		name_full: z.string().optional(),
		email: z.string(),
		country: GeoRefSchema.optional()
	}),
	vatsim: z
		.looseObject({
			rating: RatingSchema.optional(),
			pilotrating: RatingSchema.optional(),
			region: GeoRefSchema.optional(),
			division: GeoRefSchema.optional(),
			subdivision: GeoRefSchema.optional()
		})
		.optional(),
	oauth: z
		.looseObject({
			token_valid: z.string().optional()
		})
		.optional()
});

export type VatsimProfile = z.infer<typeof VatsimProfileSchema>;

const VATSIM_SCOPES = ['full_name', 'vatsim_details', 'email'];

export function buildVatsimClient(env: Cloudflare.Env): OAuth2Client {
	return new OAuth2Client(
		env.CONNECT_CLIENT_ID,
		env.CONNECT_CLIENT_SECRET,
		env.CONNECT_CALLBACK_URL
	);
}

export function buildAuthorizationUrl(env: Cloudflare.Env, state: string): URL {
	const client = buildVatsimClient(env);
	return client.createAuthorizationURL(
		`${env.CONNECT_BASE_URL}/oauth/authorize`,
		state,
		VATSIM_SCOPES
	);
}

export async function exchangeCodeForToken(env: Cloudflare.Env, code: string): Promise<string> {
	const client = buildVatsimClient(env);
	const tokens = await client.validateAuthorizationCode(
		`${env.CONNECT_BASE_URL}/oauth/token`,
		code,
		null
	);
	return tokens.accessToken();
}

const VatsimResponseSchema = z.object({ data: VatsimProfileSchema });

export async function fetchVatsimProfile(
	connectBaseUrl: string,
	accessToken: string
): Promise<VatsimProfile> {
	const res = await fetch(`${connectBaseUrl}/api/user`, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
	});
	if (!res.ok) {
		throw new IdentityError(
			'vatsim_profile_failed',
			502,
			`VATSIM /api/user returned ${res.status}`
		);
	}
	const parsed = VatsimResponseSchema.safeParse(await res.json());
	if (!parsed.success) {
		throw new IdentityError('vatsim_profile_failed', 502, 'malformed VATSIM response');
	}
	return parsed.data.data;
}
