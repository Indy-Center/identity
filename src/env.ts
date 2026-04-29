export type Env = {
	// Filled in over subsequent tasks (D1 binding, secrets, vars).
};

export type AppVariables = {
	// Per-request context populated by middleware (e.g. logger child, request id).
};
