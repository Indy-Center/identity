import { z } from 'zod';

// Shape of the VATSIM /api/user OAuth payload — the chunk we store as
// vatsim_data and expose to consumers. Mirrors the published response
// schema so consumers get IntelliSense for known fields without digging
// into the stored payload.
//
// Full reference: https://vatsim.dev/api/connect-api/get-user
//
// Validation is intentionally lax: looseObject everywhere (zod 4's
// modern replacement for .passthrough() — keeps unknown keys instead
// of stripping them), and most fields are optional. Only `cid` (the
// trustworthy identity) and `personal.email` (used as the email column
// in our DB) are required. Everything else is documented but tolerates
// VATSIM-side data quality issues without failing OAuth.

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
