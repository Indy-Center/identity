import { z } from 'zod';

export const OperatingInitialsSchema = z.string().regex(/^[A-Z]{2}$/);

export const AttributesSchema = z
	.object({
		preferredName: z.string().optional(),
		pronouns: z.string().optional(),
		operatingInitials: OperatingInitialsSchema.optional(),
		discordId: z.string().optional(),
		disabledReason: z.string().optional(),
		disabledAt: z.number().optional(),
		disabledBy: z.string().optional()
	})
	.catchall(z.unknown());

export const AttributePatchSchema = z
	.object({
		preferredName: z.string().nullable().optional(),
		pronouns: z.string().nullable().optional(),
		operatingInitials: OperatingInitialsSchema.nullable().optional(),
		discordId: z.string().nullable().optional(),
		disabledReason: z.string().nullable().optional(),
		disabledAt: z.number().nullable().optional(),
		disabledBy: z.string().nullable().optional()
	})
	.catchall(z.unknown());
