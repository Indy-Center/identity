import { AppError } from '../lib/errors';
import type { VatsimProfile } from './users';

type VatsimUserResponse = { data: VatsimProfile };

export async function fetchVatsimProfile(
	connectBaseUrl: string,
	accessToken: string
): Promise<VatsimProfile> {
	const res = await fetch(`${connectBaseUrl}/api/user`, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
	});
	if (!res.ok) {
		throw new AppError('vatsim_profile_failed', 502, `VATSIM /api/user returned ${res.status}`);
	}
	const body = (await res.json()) as VatsimUserResponse;
	return body.data;
}
