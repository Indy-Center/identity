// /api: every module's routes run behind `principal`. No CORS: server-to-server only.
import { Hono } from 'hono';
import { clientRoutes } from '../clients/routes';
import { userRoutes } from '../users/routes';
import { principal, type ApiEnv } from './principal';

export const apiRoutes = new Hono<ApiEnv>();
// Every /api response carries bearer-token-derived data; none of it is cacheable.
apiRoutes.use('*', async (c, next) => {
	await next();
	c.header('Cache-Control', 'no-store');
});
apiRoutes.use('*', principal);
apiRoutes.route('/', userRoutes);
apiRoutes.route('/', clientRoutes);
