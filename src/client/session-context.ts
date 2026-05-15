// src/client/session-context.ts
import type { User } from './user';
import type { OnlineController } from './online-controller';
import type { FlightPlan } from './flight-plan';

export type SessionContext = {
	user: User;
	roles: string[];
	sessionExpiresAt: Date;
	activeSession: OnlineController | null;
	activeFlightPlan: FlightPlan | null;
};
