// src/client/vatsim.ts
// Public type surface. Validation schema lives in src/auth/vatsim-schema.ts —
// runtime accepts unknown extra fields via Zod's `z.looseObject`; the type only
// exposes what consumers should rely on.

type Rating = {
	id?: number;
	short?: string;
	long?: string;
};

type GeoRef = {
	id?: string | null;
	name?: string | null;
};

export type VatsimProfile = {
	cid: string;
	personal: {
		name_first?: string;
		name_last?: string;
		name_full?: string;
		email: string;
		country?: GeoRef;
	};
	vatsim?: {
		rating?: Rating;
		pilotrating?: Rating;
		region?: GeoRef;
		division?: GeoRef;
		subdivision?: GeoRef;
	};
	oauth?: {
		token_valid?: string;
	};
};
