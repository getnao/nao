import type { LlmProvider } from '@nao/shared/types';

import * as budgetQueries from '../queries/budget.queries';
import { HandlerError } from './error';

export async function assertBudgetNotExceeded(projectId: string, provider: LlmProvider): Promise<void> {
	const budget = await budgetQueries.getProviderBudget(projectId, provider);
	if (!budget || budget.limitUsd <= 0) {
		return;
	}

	await budgetQueries.advanceStaleBudgetPeriods(projectId, provider);

	const currentSpend = await budgetQueries.getProviderCurrentSpend(projectId, provider);
	if (currentSpend >= budget.limitUsd) {
		throw new HandlerError(
			'FORBIDDEN',
			`Budget limit reached for ${provider}. Current spend: $${currentSpend}, limit: $${budget.limitUsd}/${budget.period}.`,
		);
	}
}
