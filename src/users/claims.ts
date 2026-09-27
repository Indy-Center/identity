// src/users/claims.ts
// The one user serializer. Standard OIDC Core §5.1 claim names where one
// exists (sub, name, given_name, family_name); snake_case custom claims
// otherwise. Never includes email or the raw VATSIM profile: /oauth/userinfo
// adds email for the user themself, /api/users returns this as-is.
import type { User } from '../schema';

export type Claims = ReturnType<typeof toClaims>;

export function toClaims(user: User, roles: string[]) {
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
		active: user.active
	};
}
