// The one user serializer. Standard OIDC Core §5.1 claim names where one
// exists (sub, name, given_name, family_name); snake_case custom claims
// otherwise. Never includes email or the raw VATSIM profile: /oauth/userinfo
// adds email for the user themself, /api/users returns this as-is.
import { z } from 'zod';
import type { User } from '../schema';

// The OpenAPI doc schema for toClaims()'s shape — not used to validate
// anything. toClaims()'s return type is annotated against Claims (below), so
// the two can never drift without a typecheck failure.
export const ClaimsSchema = z.object({
	sub: z.string(),
	name: z.string(),
	given_name: z.string().nullable(),
	family_name: z.string().nullable(),
	preferred_name: z.string().nullable(),
	pronouns: z.string().nullable(),
	rating: z.string().nullable(),
	pilot_rating: z.string().nullable(),
	division: z.string().nullable(),
	region: z.string().nullable(),
	subdivision: z.string().nullable(),
	roles: z.array(z.string()),
	operating_initials: z.string().nullable(),
	discord_id: z.string().nullable(),
	teamspeak_uid: z.string().nullable(),
	active: z.boolean()
});

export type Claims = z.infer<typeof ClaimsSchema>;

export function toClaims(user: User, roles: string[]): Claims {
	return {
		sub: user.cid,
		name: user.preferredName ?? [user.firstName, user.lastName].filter(Boolean).join(' '),
		given_name: user.firstName,
		family_name: user.lastName,
		preferred_name: user.preferredName,
		pronouns: user.pronouns,
		rating: user.rating,
		pilot_rating: user.pilotRating,
		division: user.division,
		region: user.region,
		subdivision: user.subdivision,
		roles,
		operating_initials: user.operatingInitials,
		discord_id: user.discordId,
		teamspeak_uid: user.teamspeakUid,
		active: user.active
	};
}
