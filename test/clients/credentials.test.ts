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

	it('is invalid when both methods are used or Basic is malformed', () => {
		expect(parseClientCredentials(basic('a', 'b'), { client_secret: 'b' })).toBe('invalid');
		expect(parseClientCredentials('Basic !!!', {})).toBe('invalid');
		expect(parseClientCredentials(`Basic ${btoa('nocolon')}`, {})).toBe('invalid');
		expect(parseClientCredentials(`Basic ${btoa('a:%E0%A4%A')}`, {})).toBe('invalid');
	});
});
