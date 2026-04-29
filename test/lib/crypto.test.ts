import { describe, expect, it } from 'vitest';
import { randomBase32, sha256Hex } from '../../src/lib/crypto';

describe('randomBase32', () => {
	it('returns a 32-char base32 string from 20 random bytes', () => {
		const a = randomBase32(20);
		expect(a).toMatch(/^[a-z2-7]{32}$/);
	});
	it('produces distinct outputs across calls', () => {
		expect(randomBase32(20)).not.toBe(randomBase32(20));
	});
});

describe('sha256Hex', () => {
	it('produces deterministic hex digests', async () => {
		const h1 = await sha256Hex('hello');
		const h2 = await sha256Hex('hello');
		expect(h1).toBe(h2);
		expect(h1).toMatch(/^[0-9a-f]{64}$/);
	});
	it('differs across inputs', async () => {
		expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
	});
});
