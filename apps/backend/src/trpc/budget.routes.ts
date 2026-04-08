import { LlmProvider } from '@nao/shared/types';

import { PROVIDER_META } from '../agents/provider-meta';
import { adminProtectedProcedure } from './trpc';

export const budgetRoutes = {
	getProvidersCostSupport: adminProtectedProcedure.query(async () => {
		return Object.fromEntries(
			Object.entries(PROVIDER_META).map(([provider, meta]) => [
				provider,
				meta.models.some((m) => m.costPerM !== undefined),
			]),
		) as Record<LlmProvider, boolean>;
	}),
};
