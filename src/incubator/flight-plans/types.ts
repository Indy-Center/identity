import type { z } from 'zod';
import type { FlightPlanSchema, PilotSchema } from './schema';

export type FlightPlan = z.infer<typeof FlightPlanSchema>;
export type Pilot = z.infer<typeof PilotSchema>;
