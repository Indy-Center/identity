const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function randomBase32(byteLength: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
	return bytesToBase32(bytes);
}

function bytesToBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]!;
			bits -= 5;
		}
	}
	if (bits > 0) {
		out += BASE32_ALPHABET[(value << (5 - bits)) & 31]!;
	}
	return out;
}

export async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
