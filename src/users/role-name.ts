// src/users/role-name.ts
// `app:permission`, e.g. events:can_sign_up. The prefix keeps apps' names apart.
// Dependency-free so scripts/manage-sql.ts can import it under Node.
export const ROLE_NAME = /^[a-z0-9_-]+:[a-z0-9_.-]+$/;
