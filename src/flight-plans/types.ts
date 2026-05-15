// src/flight-plans/types.ts
import type { z } from 'zod';
import type { FlightPlanSchema, PilotSchema, VatsimDataFeedSchema } from './schema';

export type FlightPlan = z.infer<typeof FlightPlanSchema>;
export type Pilot = z.infer<typeof PilotSchema>;
export type VatsimDataFeed = z.infer<typeof VatsimDataFeedSchema>;
