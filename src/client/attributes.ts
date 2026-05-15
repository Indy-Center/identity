// src/client/attributes.ts
// Public type surface. Validation schemas live in src/users/attributes-schema.ts.

export type OperatingInitials = string; // /^[A-Z]{2}$/

export type Attributes = {
	preferredName?: string;
	pronouns?: string;
	operatingInitials?: OperatingInitials;
	discordId?: string;
	disabledReason?: string;
	disabledAt?: number;
	disabledBy?: string;
	[key: string]: unknown;
};

export type AttributePatch = {
	preferredName?: string | null;
	pronouns?: string | null;
	operatingInitials?: OperatingInitials | null;
	discordId?: string | null;
	disabledReason?: string | null;
	disabledAt?: number | null;
	disabledBy?: string | null;
	[key: string]: unknown;
};
