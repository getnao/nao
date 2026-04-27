import { getNextPeriodStart } from '@nao/shared/date';
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
		message: buildBudgetMessage(usage.ratio, providerLabels[provider], usage.resetLabel),
	};
}

export async function assertBudgetNotExceeded(projectId: string, provider: LlmProvider): Promise<void> {
	const usage = await resolveBudgetUsage(projectId, provider);
	if (!usage || usage.ratio < 1) {
		return;
	}

	await notifyAdminsOnBudgetLimitReached(projectId, usage.budget, usage.currentSpend, usage.resetLabel).catch(
		() => {},
	);
	throw new BudgetExceededError(buildBudgetMessage(usage.ratio, providerLabels[provider], usage.resetLabel));
}

function buildBudgetMessage(ratio: number, providerLabel: string, resetLabel: string): string {
	const percent = Math.min(Math.round(ratio * 100), 100);
	return `You've used ${percent}% of your ${providerLabel} budget. It will reset ${resetLabel}.`;
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
	const resetLabel = formatResetDate(getNextPeriodStart(period), period);

	return { budget, currentSpend, ratio, resetLabel };
}

async function notifyAdminsOnBudgetLimitReached(
	projectId: string,
	budget: DBProjectProviderBudget,
	currentSpendUsd: number,
	resetLabel: string,
): Promise<void> {
	if (!emailService.isEnabled()) {
		return;
	}

	if (!shouldAttemptNotify(budget)) {
		return;
	}

	const allMembers = await projectQueries.listAllUsersWithRoles(projectId);
	const admins = allMembers.filter((m) => m.role === 'admin');
	if (admins.length === 0) {
		return;
	}

	const claimed = await budgetQueries.claimBudgetNotification(budget);
	if (!claimed) {
		return;
	}

	const period = budget.period as BudgetPeriod;
	const label = providerLabels[budget.provider as LlmProvider] ?? budget.provider;

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
		await budgetQueries.rollbackBudgetNotification(budget).catch(() => {});
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
