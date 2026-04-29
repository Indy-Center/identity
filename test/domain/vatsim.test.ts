import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchVatsimProfile } from '../../src/domain/vatsim';
import { AppError } from '../../src/lib/errors';

describe('fetchVatsimProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns parsed profile on 200', async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						data: { cid: '999', personal: { name_first: 'A', name_last: 'B', email: 'a@b.com' } }
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);
		globalThis.fetch = mockFetch as any;

		const profile = await fetchVatsimProfile('https://auth.vatsim.net', 'access_token_xyz');
		expect(profile.cid).toBe('999');
		expect(profile.personal.email).toBe('a@b.com');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://auth.vatsim.net/api/user',
			expect.objectContaining({
				headers: { Authorization: 'Bearer access_token_xyz', Accept: 'application/json' }
			})
		);
	});

	it('throws AppError(vatsim_profile_failed, 502) on non-200', async () => {
		const mockFetch = vi.fn().mockResolvedValue(new Response('oops', { status: 500 }));
		globalThis.fetch = mockFetch as any;

		await expect(
			fetchVatsimProfile('https://auth.vatsim.net', 'access_token_xyz')
		).rejects.toMatchObject({
			code: 'vatsim_profile_failed',
			status: 502
		});
		expect.hasAssertions();
	});
});
