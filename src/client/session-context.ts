// src/client/session-context.ts
import type { User } from './user.js';
import type { OnlineController } from './online-controller.js';
import type { FlightPlan } from './flight-plan.js';

export type SessionContext = {
	user: User;
	roles: string[];
	sessionExpiresAt: Date;
	activeSession: OnlineController | null;
	activeFlightPlan: FlightPlan | null;
};
