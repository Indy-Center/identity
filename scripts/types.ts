// Shape of a row exported from community-website's D1 — only the columns we map.
export type CWUser = {
	id: string;
	cid: string;
	email: string;
	first_name: string;
	last_name: string;
	preferred_name?: string | null;
	pronouns?: string | null;
	discord_id?: string | null;
	data: string; // JSON-stringified VATSIM profile (community-website's `users.data`)
};

export type CWUserRole = {
	user_id: string;
	role: string;
};

// Shape of an INSERT statement we'll feed to wrangler d1 execute --file.
export type SqlStatement = string;
