import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
	const migrationsPath = new URL('src/db/migrations', import.meta.url).pathname;
	const migrations = await readD1Migrations(migrationsPath);

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					compatibilityDate: '2026-04-01',
					compatibilityFlags: ['nodejs_compat'],
					bindings: {
						TEST_MIGRATIONS: migrations,
						CONNECT_CLIENT_ID: 'test_client_id',
						CONNECT_CLIENT_SECRET: 'test_client_secret',
						CONNECT_BASE_URL: 'https://auth.vatsim.net',
						CONNECT_CALLBACK_URL: 'https://auth.flyindycenter.com/login/callback',
						COOKIE_DOMAIN: '.flyindycenter.com'
					}
				}
			})
		],
		test: {
			setupFiles: ['./test/helpers/apply-migrations.ts']
		}
	};
});
