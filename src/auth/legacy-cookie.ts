// The pre-OAuth flow set `fic_session` with Domain=.flyindycenter.com so every
// app could read one shared cookie. Delete this after 2026-11 (30 days past
// the deploy that replaced it with per-app host-only sessions).
import type { Context } from 'hono';
import { deleteCookie } from 'hono/cookie';

export function clearLegacySessionCookie(c: Context): void {
	deleteCookie(c, 'fic_session', { domain: '.flyindycenter.com', path: '/', secure: true });
}
