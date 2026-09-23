// src/client/index.ts
// Public surface of @indy-center/identity 1.1.0.

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
