import { getNextPeriodReset } from '@nao/shared/date';
import { type LlmProvider, providerLabels, WARNING_BUDGET_THRESHOLD } from '@nao/shared/types';

import type { DBProjectProviderBudget } from '../db/abstractSchema';
import * as budgetQueries from '../queries/budget.queries';
import * as projectQueries from '../queries/project.queries';
import { emailService } from '../services/email';
import type { BudgetPeriod } from '../types/budget';
import { buildBudgetLimitReachedEmail } from './email-builders';
import { BudgetExceededError } from './error';
import { logger } from './logger';

export type BudgetStatus = { level: 'ok' | 'warning' | 'exceeded'; message: string | null };

export async function checkBudgetStatus(projectId: string, provider: LlmProvider): Promise<BudgetStatus> {
	const usage = await resolveBudgetUsage(projectId, provider);
	if (!usage || usage.ratio < WARNING_BUDGET_THRESHOLD) {
		return { level: 'ok', message: null };
	}

	return {
		level: usage.ratio >= 1 ? 'exceeded' : 'warning',
		message: `You've used ${usage.ratio * 100}% of your ${providerLabels[provider]} budget. It will reset ${usage.resetLabel}.`,
	};
}

export async function assertBudgetNotExceeded(projectId: string, provider: LlmProvider): Promise<void> {
	const usage = await resolveBudgetUsage(projectId, provider);
	if (!usage || usage.ratio < 1) {
		return;
	}

	const message = `You've used 100% of your ${providerLabels[provider]} budget. It will reset ${usage.resetLabel}.`;
	notifyAdminsOnBudgetLimitReached(projectId, usage.budget, usage.currentSpend).catch(() => {});
	throw new BudgetExceededError(message);
}

async function resolveBudgetUsage(projectId: string, provider: LlmProvider) {
	const budget = await budgetQueries.getProviderBudget(projectId, provider);
	if (!budget || budget.limitUsd <= 0) {
		return null;
	}

	await budgetQueries.advanceStaleBudgetPeriods(projectId, provider);
	const currentSpend = await budgetQueries.getProviderCurrentSpend(projectId, provider);
	const ratio = currentSpend / budget.limitUsd;
	const period = budget.period as BudgetPeriod;
	const resetLabel = formatResetDate(getNextPeriodReset(period), period);

	return { budget, currentSpend, ratio, resetLabel };
}

export async function notifyAdminsOnBudgetLimitReached(
	projectId: string,
	budget: DBProjectProviderBudget,
	currentSpendUsd: number,
): Promise<void> {
	if (!emailService.isEnabled()) {
		return;
	}

	if (!shouldAttemptNotify(budget)) {
		return;
	}

	const claimed = await budgetQueries.markBudgetNotified(budget);
	if (!claimed) {
		return;
	}

	const period = budget.period as BudgetPeriod;
	const label = providerLabels[budget.provider as LlmProvider] ?? budget.provider;
	const resetDate = getNextPeriodReset(period);
	const resetLabel = formatResetDate(resetDate, period);

	const allMembers = await projectQueries.getAllUsersWithRoles(projectId);
	const admins = allMembers.filter((m) => m.role === 'admin');

	if (admins.length === 0) {
		return;
	}

	try {
		await Promise.all(
			admins.map((admin) =>
				emailService.sendEmail(
					admin.email,
					buildBudgetLimitReachedEmail(admin, label, budget.limitUsd, currentSpendUsd, period, resetLabel),
				),
			),
		);
	} catch (error) {
		logger.error(`Failed to send budget limit notification: ${String(error)}`, { source: 'system' });
	}
}

function shouldAttemptNotify(budget: DBProjectProviderBudget): boolean {
	if (!budget.notifiedAt) {
		return true;
	}
	return budget.notifiedAt.getTime() < budget.currentPeriodStart.getTime();
}

function formatResetDate(date: Date, period: BudgetPeriod): string {
	if (period === 'day') {
		return 'tomorrow';
	}
	return `on ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
}
