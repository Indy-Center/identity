import type { CWUser, CWUserRole, SqlStatement } from './types';

export function escape(value: string | null | undefined): string {
	if (value == null) return 'NULL';
	return `'${value.replace(/'/g, "''")}'`;
}

export function buildUserInserts(rows: CWUser[], now: () => number): SqlStatement[] {
	return rows.map((u) => {
		const t = now();
		return [
			'INSERT INTO users (id, cid, email, first_name, last_name, preferred_name, pronouns, discord_id, vatsim_data, created_at, updated_at) VALUES (',
			[
				escape(u.id),
				escape(u.cid),
				escape(u.email),
				escape(u.first_name),
				escape(u.last_name),
				escape(u.preferred_name ?? null),
				escape(u.pronouns ?? null),
				escape(u.discord_id ?? null),
				escape(u.data),
				String(t),
				String(t)
			].join(', '),
			');'
		].join('');
	});
}

export function buildRoleInserts(rows: CWUserRole[], now: () => number): SqlStatement[] {
	return rows.map(
		(r) =>
			`INSERT INTO user_roles (user_id, role, granted_at, granted_by) VALUES (${escape(r.user_id)}, ${escape(r.role)}, ${String(now())}, 'migration:initial');`
	);
}
