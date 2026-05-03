import { describe, expect, it } from 'vitest';
import { VatsimProfileSchema, type VatsimProfile } from '../../src/client/vatsim';

describe('VatsimProfileSchema', () => {
	it('parses a minimal valid profile', () => {
		const v: VatsimProfile = VatsimProfileSchema.parse({
			cid: '999',
			personal: {
				name_first: 'Test',
				name_last: 'User',
				email: 'test@example.com'
			}
		});
		expect(v.cid).toBe('999');
		expect(v.personal.name_first).toBe('Test');
	});

	it('preserves extra top-level fields via passthrough', () => {
		const v = VatsimProfileSchema.parse({
			cid: '999',
			personal: { name_first: 'A', name_last: 'B', email: 'a@b' },
			vatsim: { rating: { id: 1 } }
		});
		expect(v).toMatchObject({ vatsim: { rating: { id: 1 } } });
	});

	it('preserves extra personal fields via passthrough', () => {
		const v = VatsimProfileSchema.parse({
			cid: '999',
			personal: {
				name_first: 'A',
				name_last: 'B',
				email: 'a@b',
				country: { id: 'US' }
			}
		});
		expect(v.personal).toMatchObject({ country: { id: 'US' } });
	});

	it('rejects missing cid', () => {
		expect(() =>
			VatsimProfileSchema.parse({
				personal: { name_first: 'A', name_last: 'B', email: 'a@b' }
			})
		).toThrow();
	});

	it('rejects missing personal block', () => {
		expect(() => VatsimProfileSchema.parse({ cid: '999' })).toThrow();
	});
});
