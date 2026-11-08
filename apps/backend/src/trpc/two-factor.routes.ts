import { getTwoFactorStatus } from '../services/two-factor.service';
import { protectedProcedure } from './trpc';

export const twoFactorRoutes = {
	getStatus: protectedProcedure.query(async ({ ctx }) => getTwoFactorStatus(ctx.user.id)),
};
