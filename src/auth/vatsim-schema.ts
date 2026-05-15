import { z } from 'zod';

// Shape of the VATSIM /api/user OAuth payload — the chunk we store as
// vatsim_data and expose to consumers. Full reference:
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
