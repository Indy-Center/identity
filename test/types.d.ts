/// <reference types="@cloudflare/workers-types" />

interface Headers {
	getSetCookie(): string[];
}

declare namespace Cloudflare {
	interface Env {
		DB: D1Database;
		TEST_MIGRATIONS: D1Migration[];
		CONNECT_CLIENT_ID: string;
		CONNECT_CLIENT_SECRET: string;
		CONNECT_BASE_URL: string;
		CONNECT_CALLBACK_URL: string;
		COOKIE_DOMAIN: string;
	}
}
