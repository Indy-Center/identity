/**
 * One structured line per security-relevant event. Workers Logs indexes the
 * fields, so they can be filtered on (event, cid, client_id, by). Never pass a
 * token, secret, authorization code or email.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
	console.log({ event, ...fields });
}
