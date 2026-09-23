// src/client/index.ts
// Public surface of @indy-center/identity 1.1.0.

export type { SessionContext } from './session-context.js';
export type { OnlineController, VnasPosition, VnasVatsimData } from './online-controller.js';
export type { FlightPlan } from './flight-plan.js';
export type { User } from './user.js';
export type { VatsimProfile } from './vatsim.js';
export type {
	Attributes,
	AttributePatch,
	AttributeValue,
	OperatingInitials
} from './attributes.js';
export {
	IdentityError,
	isIdentityError,
	getIdentityErrorCode,
	getStatusForCode,
	type ErrorCode
} from './errors.js';
export {
	SessionContextWireSchema,
	TokenResponseWireSchema,
	OAuthErrorWireSchema,
	ErrorWireSchema,
	type SessionContextWire,
	type UserinfoWire
} from './wire.js';
export {
	createIdentityClient,
	sessionCookieOptions,
	DEFAULT_IDENTITY_URL,
	DEFAULT_CLIENT_ID,
	SESSION_COOKIE,
	type IdentityClient,
	type IdentityClientOptions,
	type ExchangedSession,
	type CompletedLogin,
	type FetchLike
} from './client.js';
