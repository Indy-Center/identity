import type { VatsimProfile } from '../../src/client/vatsim';

export function makeVatsimProfile(overrides: Partial<VatsimProfile> = {}): VatsimProfile {
	return {
		cid: '1234567',
		personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' },
		vatsim: { rating: { id: 1, short: 'OBS', long: 'Observer' } },
		...overrides
	};
}
