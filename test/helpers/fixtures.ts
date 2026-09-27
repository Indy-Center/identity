import type { DB } from '../../src/db';
import type { VatsimProfile } from '../../src/oauth/vatsim';
import { clients, type Scope } from '../../src/schema';
import { sha256Hex } from '../../src/crypto';

export function makeVatsimProfile(overrides: Partial<VatsimProfile> = {}): VatsimProfile {
	return {
		cid: '1234567',
		personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' },
		vatsim: { rating: { id: 1, short: 'OBS', long: 'Observer' } },
		...overrides
	};
}

/** Insert a client; returns its plaintext secret. */
export async function seedClient(
	db: DB,
	id: string,
	opts: { scopes?: Scope[]; redirectUris?: string[] | null } = {}
): Promise<string> {
	const secret = `${id}_testsecret`;
	await db.insert(clients).values({
		id,
		secretHash: await sha256Hex(secret),
		redirectUris: opts.redirectUris ?? null,
		scopes: opts.scopes ?? [],
		createdAt: Date.now()
	});
	return secret;
}
