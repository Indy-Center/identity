import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';

export const healthRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

healthRoutes.get('/', (c) => c.json({ ok: true }));
