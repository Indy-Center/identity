// src/users/attributes.ts
// Public type surface. Validation schemas live in src/users/attributes-schema.ts.

export type OperatingInitials = string; // /^[A-Z]{2}$/

// JSON-compatible value for namespaced catchall keys (e.g. 'community.profile').
// Concrete rather than `unknown` so that Attributes/AttributePatch — and the
// SessionContext that embeds them — pass Cloudflare's RPC serializability check
// across service bindings.
export type AttributeValue =
	| string
	| number
	| boolean
	| null
	| AttributeValue[]
	| { [key: string]: AttributeValue | undefined };

export type Attributes = {
	preferredName?: string;
	pronouns?: string;
	operatingInitials?: OperatingInitials;
	discordId?: string;
	disabledReason?: string;
	disabledAt?: number;
	disabledBy?: string;
	[key: string]: AttributeValue | undefined;
};

export type AttributePatch = {
	preferredName?: string | null;
	pronouns?: string | null;
	operatingInitials?: OperatingInitials | null;
	discordId?: string | null;
	disabledReason?: string | null;
	disabledAt?: number | null;
	disabledBy?: string | null;
	[key: string]: AttributeValue | undefined;
};
