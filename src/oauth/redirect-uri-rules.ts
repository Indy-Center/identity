// Dependency-free redirect URI rules, shared with scripts/manage-sql.ts (Node).

// http on a loopback host (RFC 8252 §7.3) at any port. The pattern ends in
// (\/[^\s]*)?$, so a bare origin (scheme://host[:port]) matches too, and the
// trailing $ keeps raw CR/LF or other control characters out.
export const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/[^\s]*)?$/;

export const REDIRECT_URI_MAX_LENGTH = 2048;
