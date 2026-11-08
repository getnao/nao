import { getTwoFactorStatus } from '../services/two-factor.service';
import { sessionProcedure } from './trpc';

export const twoFactorRoutes = {
	getStatus: sessionProcedure.query(async ({ ctx }) => {
		return getTwoFactorStatus(ctx.user.id);
	}),
};
