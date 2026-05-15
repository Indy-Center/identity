// src/client/vatsim.ts
// Public type surface. Validation schema lives in src/auth/vatsim-schema.ts.

type Rating = {
	id?: number;
	short?: string;
	long?: string;
	[key: string]: unknown;
};

type GeoRef = {
	id?: string | null;
	name?: string | null;
	[key: string]: unknown;
};

export type VatsimProfile = {
	cid: string;
	personal: {
		name_first?: string;
		name_last?: string;
		name_full?: string;
		email: string;
		country?: GeoRef;
		[key: string]: unknown;
	};
	vatsim?: {
		rating?: Rating;
		pilotrating?: Rating;
		region?: GeoRef;
		division?: GeoRef;
		subdivision?: GeoRef;
		[key: string]: unknown;
	};
	oauth?: {
		token_valid?: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
};
