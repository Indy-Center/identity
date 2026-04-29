import { describe, expect, it } from 'vitest';
import {
	buildSessionSetCookie,
	buildSessionClearCookie,
	buildHostStateSetCookie,
	buildHostStateClearCookie
} from '../../src/domain/cookies';

describe('buildSessionSetCookie', () => {
	it('sets HttpOnly Secure SameSite=Lax on .flyindycenter.com', () => {
		const v = buildSessionSetCookie('rawtoken', '.flyindycenter.com');
		expect(v).toContain('fic_session=rawtoken');
		expect(v).toContain('Domain=.flyindycenter.com');
		expect(v).toContain('HttpOnly');
		expect(v).toContain('Secure');
		expect(v).toContain('SameSite=Lax');
		expect(v).toContain('Path=/');
		expect(v).toMatch(/Max-Age=\d+/);
	});
});

describe('buildSessionClearCookie', () => {
	it('emits Max-Age=0 on the same domain', () => {
		const v = buildSessionClearCookie('.flyindycenter.com');
		expect(v).toContain('fic_session=');
		expect(v).toContain('Max-Age=0');
		expect(v).toContain('Domain=.flyindycenter.com');
	});
});

describe('buildHostStateSetCookie', () => {
	it('uses __Host- prefix and forbids Domain', () => {
		const v = buildHostStateSetCookie('oauth_state', 'abc123');
		expect(v.startsWith('__Host-oauth_state=abc123')).toBe(true);
		expect(v).not.toContain('Domain=');
		expect(v).toContain('HttpOnly');
		expect(v).toContain('Secure');
		expect(v).toContain('SameSite=Lax');
		expect(v).toContain('Path=/');
		expect(v).toContain('Max-Age=600');
	});
});

describe('buildHostStateClearCookie', () => {
	it('clears with Max-Age=0', () => {
		const v = buildHostStateClearCookie('oauth_state');
		expect(v).toContain('__Host-oauth_state=');
		expect(v).toContain('Max-Age=0');
	});
});
