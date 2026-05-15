// src/online-controllers/schema.ts
import { z } from 'zod';

// vNAS controllers feed shape. Mirrors the publicly observable response at
// https://live.env.vnas.vatsim.net/data-feed/controllers.json. Lax — unknown
// keys are passed through with looseObject so feed evolution doesn't break us.

export const VnasVatsimDataSchema = z.looseObject({
	cid: z.string(),
	realName: z.string(),
	controllerInfo: z.string(),
	userRating: z.string(),
	callsign: z.string(),
	// Real feed sometimes omits this; vNAS reports loginTime at the controller
	// level rather than nested under vatsimData on some entries.
	loginTime: z.string().optional()
});

export const VnasPositionSchema = z.looseObject({
	facilityId: z.string(),
	facilityName: z.string(),
	positionId: z.string(),
	positionName: z.string(),
	positionType: z.string(),
	radioName: z.string(),
	defaultCallsign: z.string(),
	frequency: z.number(),
	isPrimary: z.boolean(),
	isActive: z.boolean(),
	// Some positions in the live feed don't have a callsign field; the
	// defaultCallsign field is authoritative when this is missing.
	callsign: z.string().optional()
});

export const OnlineControllerSchema = z.looseObject({
	artccId: z.string(),
	primaryFacilityId: z.string(),
	primaryPositionId: z.string(),
	role: z.string(),
	positions: z.array(VnasPositionSchema),
	isActive: z.boolean(),
	isObserver: z.boolean(),
	loginTime: z.string(),
	vatsimData: VnasVatsimDataSchema
});

export const VnasControllerResponseSchema = z.looseObject({
	controllers: z.array(OnlineControllerSchema)
});
