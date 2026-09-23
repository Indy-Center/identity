// src/client/index.ts
// Public surface of @indy-center/identity 1.0.0.

export type { SessionContext } from './session-context';
export type { OnlineController, VnasPosition, VnasVatsimData } from './online-controller';
export type { FlightPlan } from './flight-plan';
export type { User } from './user';
export type { VatsimProfile } from './vatsim';
export type { Attributes, AttributePatch, AttributeValue, OperatingInitials } from './attributes';
export {
	IdentityError,
	isIdentityError,
	getIdentityErrorCode,
	getStatusForCode,
	type ErrorCode
} from './errors.js';
