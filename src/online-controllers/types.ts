// src/online-controllers/types.ts
import type { z } from 'zod';
import type {
	OnlineControllerSchema,
	VnasPositionSchema,
	VnasVatsimDataSchema,
	VnasControllerResponseSchema
} from './schema';

export type OnlineController = z.infer<typeof OnlineControllerSchema>;
export type VnasPosition = z.infer<typeof VnasPositionSchema>;
export type VnasVatsimData = z.infer<typeof VnasVatsimDataSchema>;
export type VnasControllerResponse = z.infer<typeof VnasControllerResponseSchema>;
