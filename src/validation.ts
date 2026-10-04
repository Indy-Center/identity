// One validator wrapper, so every route reports zod failures in the identity
// error envelope instead of hono-openapi's default body.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { MiddlewareHandler, ValidationTargets } from 'hono';
import { validator } from 'hono-openapi';
import { IdentityError } from './errors';

// Hono's own test for a JSON body; anything else it silently validates as `{}`.
const JSON_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/;

/** hono-openapi's validator (so the schema lands in /openapi.json) with our 400. */
export function validate<S extends StandardSchemaV1, T extends keyof ValidationTargets>(
	target: T,
	schema: S
) {
	const inner = validator(target, schema, (result) => {
		if (!result.success) {
			const detail = result.error
				.map((i) => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message))
				.join('; ');
			throw new IdentityError('validation_failed', 400, detail || 'invalid request');
		}
	});
	if (target !== 'json') {
		return inner;
	}
	const requireJson: MiddlewareHandler = async (c, next) => {
		if (!JSON_TYPE.test(c.req.header('Content-Type') ?? '')) {
			throw new IdentityError('validation_failed', 400, 'Content-Type must be application/json');
		}
		return inner(c, next);
	};
	// Copy hono-openapi's schema metadata (a symbol property) so docs still see it.
	return Object.assign(requireJson, inner) as typeof inner;
}
