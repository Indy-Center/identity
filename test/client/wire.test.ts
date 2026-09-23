import { describe, expect, it } from 'vitest';
import { SessionContextWireSchema } from '../../src/client/wire';

const VALID = {
	user: { id: 'u1' },
	roles: ['zid:admin'],
	sessionExpiresAt: '2026-05-15T10:00:00.000Z',
	activeSession: null,
	activeFlightPlan: null
};

describe('SessionContextWireSchema', () => {
	it('parses sessionExpiresAt as an ISO string into a Date', () => {
		const parsed = SessionContextWireSchema.parse(VALID);
		expect(parsed.sessionExpiresAt).toBeInstanceOf(Date);
		expect(parsed.sessionExpiresAt.toISOString()).toBe('2026-05-15T10:00:00.000Z');
	});

	it('rejects sessionExpiresAt: null', () => {
		expect(() => SessionContextWireSchema.parse({ ...VALID, sessionExpiresAt: null })).toThrow();
	});

	it('rejects sessionExpiresAt: 0', () => {
		expect(() => SessionContextWireSchema.parse({ ...VALID, sessionExpiresAt: 0 })).toThrow();
	});

	it('strips an extra sub key', () => {
		const parsed = SessionContextWireSchema.parse({ ...VALID, sub: 'u1' });
		expect(parsed).not.toHaveProperty('sub');
	});
});
