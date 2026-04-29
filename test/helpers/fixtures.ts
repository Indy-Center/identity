export type VatsimProfile = {
	cid: string;
	personal: { name_first: string; name_last: string; email: string };
	vatsim: unknown;
};

export function makeVatsimProfile(overrides: Partial<VatsimProfile> = {}): VatsimProfile {
	return {
		cid: '1234567',
		personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' },
		vatsim: { rating: 'C1' },
		...overrides
	};
}
