import { z } from 'zod';
import { VatsimProfileSchema, type VatsimProfile } from '../client/vatsim';
import { IdentityError } from '../client/errors';

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
