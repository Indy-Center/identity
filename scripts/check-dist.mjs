// Fails when the built package is types-only or a runtime export is missing.
// Node's ESM loader also fails here if a relative import in dist/ lacks `.js`.
const m = await import('../dist/index.js');
const required = [
	'createIdentityClient',
	'IdentityError',
	'SESSION_COOKIE',
	'sessionCookieOptions',
	'SessionContextWireSchema'
];
const missing = required.filter((name) => !(name in m));
if (missing.length > 0) {
	console.error(`dist/index.js is missing runtime exports: ${missing.join(', ')}`);
	process.exit(1);
}
console.log('dist/index.js runtime exports OK');
