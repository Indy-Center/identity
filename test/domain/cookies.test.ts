import { describe, expect, it } from 'vitest';
import {
	buildSessionSetCookie,
	buildSessionClearCookie,
	buildHostStateSetCookie,
	buildHostStateClearCookie
} from '../../src/domain/cookies';

describe('buildSessionSetCookie', () => {
	it('sets HttpOnly Secure SameSite=Lax on .flyindycenter.com', () => {
		const v = buildSessionSetCookie('rawtoken', { domain: '.flyindycenter.com', secure: true });
		expect(v).toContain('fic_session=rawtoken');
		expect(v).toContain('Domain=.flyindycenter.com');
		expect(v).toContain('HttpOnly');
		expect(v).toContain('Secure');
		expect(v).toContain('SameSite=Lax');
		expect(v).toContain('Path=/');
		expect(v).toMatch(/Max-Age=\d+/);
	});

	it('omits Secure when secure=false (localhost dev)', () => {
		const v = buildSessionSetCookie('rawtoken', { domain: null, secure: false });
		expect(v).toContain('fic_session=rawtoken');
		expect(v).not.toContain('Secure');
		expect(v).toContain('HttpOnly');
		expect(v).toContain('SameSite=Lax');
	});

	it('omits Domain when domain=null (host-only cookie)', () => {
		const v = buildSessionSetCookie('rawtoken', { domain: null, secure: true });
		expect(v).not.toContain('Domain=');
		expect(v).toContain('Secure');
	});
});

describe('buildSessionClearCookie', () => {
	it('emits Max-Age=0 on the same domain', () => {
		const v = buildSessionClearCookie({ domain: '.flyindycenter.com', secure: true });
		expect(v).toContain('fic_session=');
		expect(v).toContain('Max-Age=0');
		expect(v).toContain('Domain=.flyindycenter.com');
		expect(v).toContain('Secure');
	});

	it('omits Domain and Secure for localhost dev', () => {
		const v = buildSessionClearCookie({ domain: null, secure: false });
		expect(v).toContain('fic_session=');
		expect(v).toContain('Max-Age=0');
		expect(v).not.toContain('Domain=');
		expect(v).not.toContain('Secure');
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
