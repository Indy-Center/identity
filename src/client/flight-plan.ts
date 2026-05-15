// src/client/flight-plan.ts
// Mirrors the VATSIM datafeed (https://data.vatsim.net/v3/vatsim-data.json)
// flight_plan shape. Required fields are limited to the airport identifiers;
// everything else is optional and loosely typed.

export type FlightPlan = {
	flight_rules?: string;
	aircraft?: string;
	aircraft_faa?: string;
	aircraft_short?: string;
	departure: string;
	arrival: string;
	alternate?: string;
	cruise_tas?: string;
	altitude?: string;
	deptime?: string;
	enroute_time?: string;
	fuel_time?: string;
	remarks?: string;
	route?: string;
	[key: string]: unknown;
};
