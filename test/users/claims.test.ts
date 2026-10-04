import { describe, expect, it } from 'vitest';
import { toClaims } from '../../src/users/claims';
import type { User } from '../../src/schema';

function user(overrides: Partial<User> = {}): User {
	return {
		cid: '1234567',
		firstName: 'Steven',
		lastName: 'Crow',
		email: 's@example.com',
		rating: 'C1',
		pilotRating: 'P2',
		division: 'USA',
		region: 'AMAS',
		subdivision: null,
		vatsimProfile: { cid: '1234567', personal: { email: 's@example.com' } },
		vatsimSyncedAt: 1,
		preferredName: null,
		pronouns: null,
		operatingInitials: null,
		discordId: null,
		teamspeakUid: null,
		active: true,
		disabledReason: null,
		disabledAt: null,
		createdAt: 1,
		updatedAt: 1,
		...overrides
	};
}

describe('toClaims', () => {
	it('maps columns to snake_case claims with sub = cid and no email', () => {
		expect(toClaims(user(), ['community:admin'])).toEqual({
			sub: '1234567',
			name: 'Steven Crow',
			given_name: 'Steven',
			family_name: 'Crow',
			preferred_name: null,
			pronouns: null,
			rating: 'C1',
			pilot_rating: 'P2',
			division: 'USA',
			region: 'AMAS',
			subdivision: null,
			roles: ['community:admin'],
			operating_initials: null,
			discord_id: null,
			teamspeak_uid: null,
			active: true
		});
	});

	it('uses the preferred name as the whole display name', () => {
		expect(toClaims(user({ preferredName: 'Steve C' }), []).name).toBe('Steve C');
	});

	it('builds name from whichever name parts exist', () => {
		expect(toClaims(user({ firstName: null }), []).name).toBe('Crow');
	});
});
