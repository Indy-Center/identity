// src/openapi.ts
// The one error-envelope schema for OpenAPI docs, shared by the auto-injected
// 400 (hono-openapi's own default body is {success,error,data}; ours is the
// real body error-handler.ts writes) and every route's documented 401/403/
// 404/409. Never let the two drift: this is what a client actually receives.
//
// No `openapi-types` import: `type` literals are narrowed with `as const`
// field-by-field (not on the whole object — that would make `required`
// readonly and openAPIRouteHandler wants a plain string[]), and
// openAPIRouteHandler structurally checks the result at the call site.
const ERROR_SCHEMA_NAME = 'Error';

export const errorSchemas = {
	[ERROR_SCHEMA_NAME]: {
		type: 'object' as const,
		properties: {
			error: {
				type: 'object' as const,
				properties: {
					code: { type: 'string' as const },
					message: { type: 'string' as const }
				},
				required: ['code', 'message']
			}
		},
		required: ['error']
	}
};

const ERROR_REF = { $ref: `#/components/schemas/${ERROR_SCHEMA_NAME}` };

const ERROR_DESCRIPTIONS = {
	400: 'Validation failed',
	401: 'Missing or invalid bearer token',
	403: 'Insufficient scope',
	404: 'Not found',
	409: 'Conflict'
} as const;

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS;

function errorResponse(status: ErrorStatus) {
	return {
		description: ERROR_DESCRIPTIONS[status],
		content: { 'application/json': { schema: ERROR_REF } }
	};
}

/** Passed as `defaultValidationErrorResponse` to openAPIRouteHandler. */
export const defaultValidationErrorResponse = errorResponse(400);

/** describeRoute()'s `responses` entries for the given error status codes. */
export function errors(...statuses: Exclude<ErrorStatus, 400>[]) {
	return Object.fromEntries(statuses.map((status) => [status, errorResponse(status)]));
}
