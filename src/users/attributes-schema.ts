import { z } from 'zod';
import type { AttributeValue } from './attributes';

export const OperatingInitialsSchema = z.string().regex(/^[A-Z]{2}$/);

// Mirrors the public `AttributeValue` type: JSON only, so namespaced catchall
// keys stay serializable across RPC and HTTP.
export const AttributeValueSchema: z.ZodType<AttributeValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(AttributeValueSchema),
		z.record(z.string(), AttributeValueSchema)
	])
);

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
	.catchall(AttributeValueSchema);

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
	.catchall(AttributeValueSchema);
