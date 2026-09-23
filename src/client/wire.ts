// src/client/wire.ts
// JSON shapes on the HTTP API. The server serializes with these helpers; the
// HTTP transport in the client in ./client.ts (Task 8) parses with these
// schemas. Kept together so the two sides cannot drift.
import { z } from 'zod';
import type { SessionContext } from './session-context';
import type { User } from './user';
import type { OnlineController } from './online-controller';
import type { FlightPlan } from './flight-plan';

/** SessionContext as JSON: identical except the Date is an ISO string. */
export type SessionContextWire = Omit<SessionContext, 'sessionExpiresAt'> & {
	sessionExpiresAt: string;
};

/** Body of GET /oauth/userinfo: the standard claims plus the session context. */
export type UserinfoWire = SessionContextWire & { sub: string; email: string; name: string };

export function serializeSessionContext(ctx: SessionContext): SessionContextWire {
	return { ...ctx, sessionExpiresAt: ctx.sessionExpiresAt.toISOString() };
}

export function serializeUserinfo(ctx: SessionContext): UserinfoWire {
	const { name_full, name_first, name_last } = ctx.user.vatsimData.personal;
	return {
		sub: ctx.user.id,
		email: ctx.user.email,
		name: name_full || [name_first, name_last].filter(Boolean).join(' '),
		...serializeSessionContext(ctx)
	};
}

const isObject = (v: unknown) => typeof v === 'object' && v !== null;

// z.object strips unknown keys, so parsing a userinfo body (which adds sub,
// email, name) yields a plain SessionContext.
// user/activeSession/activeFlightPlan are nested objects trusted from the
// server and not validated field-by-field.
export const SessionContextWireSchema = z.object({
	user: z.custom<User>(isObject),
	roles: z.array(z.string()),
	sessionExpiresAt: z.iso.datetime().transform((s) => new Date(s)),
	activeSession: z.custom<OnlineController>(isObject).nullable(),
	activeFlightPlan: z.custom<FlightPlan>(isObject).nullable()
});

/** Success body of POST /oauth/token (RFC 6749 §5.1). */
export const TokenResponseWireSchema = z.object({
	access_token: z.string().min(1),
	token_type: z.string(),
	expires_in: z.number()
});

/** Error body of the /oauth/* endpoints (RFC 6749 §5.2). */
export const OAuthErrorWireSchema = z.object({
	error: z.string(),
	error_description: z.string().optional()
});

/** Error envelope of every other identity route. */
export const ErrorWireSchema = z.object({
	error: z.object({ code: z.string(), message: z.string() })
});
