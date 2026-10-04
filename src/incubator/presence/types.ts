import type { z } from 'zod';
import type { OnlineControllerSchema } from './schema';

export type OnlineController = z.infer<typeof OnlineControllerSchema>;
