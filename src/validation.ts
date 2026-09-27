// src/validation.ts
// One validator wrapper, so every route reports zod failures in the identity
// error envelope instead of hono-openapi's default body.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ValidationTargets } from 'hono';
import { validator } from 'hono-openapi';
import { IdentityError } from './errors';

/** hono-openapi's validator (so the schema lands in /openapi.json) with our 400. */
export function validate<S extends StandardSchemaV1, T extends keyof ValidationTargets>(
	target: T,
	schema: S
) {
	return validator(target, schema, (result) => {
		if (!result.success) {
			const detail = result.error.map((i) => `${i.path?.join('.') ?? ''}: ${i.message}`).join('; ');
			throw new IdentityError('validation_failed', 400, detail || 'invalid request');
		}
	});
}
