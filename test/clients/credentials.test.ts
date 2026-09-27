import { describe, expect, it } from 'vitest';
import { parseClientCredentials } from '../../src/clients/credentials';

const basic = (id: string, secret: string) =>
	`Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;

describe('parseClientCredentials', () => {
	it('reads client_secret_basic, URL-decoding both parts', () => {
		expect(parseClientCredentials(basic('moodle', 'a:b%c'), {})).toEqual({
			clientId: 'moodle',
			secret: 'a:b%c'
		});
	});

	it('reads client_secret_post', () => {
		expect(parseClientCredentials(undefined, { client_id: 'moodle', client_secret: 's' })).toEqual({
			clientId: 'moodle',
			secret: 's'
		});
	});

	it('returns null when no secret is presented', () => {
		expect(parseClientCredentials(undefined, { client_id: 'charts' })).toBeNull();
	});

	it('returns null for a secret without a client_id', () => {
		expect(parseClientCredentials(undefined, { client_secret: 's' })).toBeNull();
	});

	it('ignores a non-Basic Authorization header and reads the form', () => {
		expect(parseClientCredentials('Bearer x', { client_id: 'moodle', client_secret: 's' })).toEqual(
			{ clientId: 'moodle', secret: 's' }
		);
	});

	it('is ambiguous when both methods are used', () => {
		expect(parseClientCredentials(basic('a', 'b'), { client_secret: 'b' })).toBe('ambiguous');
	});

	it('is malformed when the Basic header cannot be decoded', () => {
		expect(parseClientCredentials('Basic !!!', {})).toBe('malformed');
		expect(parseClientCredentials(`Basic ${btoa('nocolon')}`, {})).toBe('malformed');
		expect(parseClientCredentials(`Basic ${btoa('a:%E0%A4%A')}`, {})).toBe('malformed');
	});
});
