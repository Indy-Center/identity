import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';

export function randomBase32(byteLength: number): string {
	return encodeBase32LowerCaseNoPadding(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return encodeHexLowerCase(new Uint8Array(digest));
}
