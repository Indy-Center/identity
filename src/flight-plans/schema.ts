// src/flight-plans/schema.ts
import { z } from 'zod';

// Subset of the public VATSIM datafeed (https://data.vatsim.net/v3/vatsim-data.json)
// that we care about: pilot CIDs and their filed flight plans. Lax — only
// the airport identifiers are required; the upstream feed occasionally
// omits/nulls other fields.

export const FlightPlanSchema = z.looseObject({
	flight_rules: z.string().optional(),
	aircraft: z.string().optional(),
	aircraft_faa: z.string().optional(),
	aircraft_short: z.string().optional(),
	departure: z.string(),
	arrival: z.string(),
	alternate: z.string().optional(),
	cruise_tas: z.string().optional(),
	altitude: z.string().optional(),
	deptime: z.string().optional(),
	enroute_time: z.string().optional(),
	fuel_time: z.string().optional(),
	remarks: z.string().optional(),
	route: z.string().optional()
});

export const PilotSchema = z.looseObject({
	cid: z.number(),
	name: z.string().optional(),
	callsign: z.string().optional(),
	flight_plan: FlightPlanSchema.nullable().optional()
});

export const VatsimDataFeedSchema = z.looseObject({
	pilots: z.array(PilotSchema)
});
