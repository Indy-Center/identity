import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				compatibilityDate: '2026-04-01',
				compatibilityFlags: ['nodejs_compat']
			}
		})
	]
});
