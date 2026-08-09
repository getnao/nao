import { getNextPeriodStart } from '@nao/shared/date';
import { type LlmProvider, providerLabel, WARNING_BUDGET_THRESHOLD } from '@nao/shared/types';

import type { DBProjectProviderBudget } from '../db/abstractSchema';
import * as budgetQueries from '../queries/budget.queries';
import * as projectQueries from '../queries/project.queries';
import { emailService } from '../services/email';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import type { BudgetPeriod } from '../types/budget';
import { buildBudgetLimitReachedEmail } from './email-builders';
import { BudgetExceededError } from './error';
import { logger } from './logger';

export type BudgetStatus = { level: 'ok' | 'warning' | 'exceeded'; message: string | null };

export async function checkBudgetStatus(
	projectId: string,
	provider: LlmProvider,
	userId?: string,
): Promise<BudgetStatus> {
	const [projectUsage, userUsage] = await Promise.all([
		resolveBudgetUsage(projectId, provider),
		resolveUserBudgetUsage(projectId, provider, userId),
	]);

	const statuses = [projectUsage, userUsage].filter(Boolean) as BudgetUsage[];
	if (statuses.length === 0 || statuses.every((u) => u.ratio < WARNING_BUDGET_THRESHOLD)) {
		return { level: 'ok', message: null };
	}

	const exceeded = statuses.find((u) => u.ratio >= 1);
	const worst = exceeded ?? statuses.find((u) => u.ratio >= WARNING_BUDGET_THRESHOLD) ?? statuses[0];
	return {
		level: worst.ratio >= 1 ? 'exceeded' : 'warning',
		message: buildBudgetMessage(worst.ratio, providerLabel(provider), worst.resetLabel, worst.scope),
	};
}

export async function assertBudgetNotExceeded(
	projectId: string,
	provider: LlmProvider,
	userId?: string,
): Promise<void> {
	const [projectUsage, userUsage] = await Promise.all([
		resolveBudgetUsage(projectId, provider),
		resolveUserBudgetUsage(projectId, provider, userId),
	]);

	if (projectUsage && projectUsage.ratio >= 1) {
		await notifyAdminsOnBudgetLimitReached(
			projectId,
			projectUsage.budget,
			projectUsage.currentSpend,
			projectUsage.resetLabel,
		).catch(() => {});
		throw new BudgetExceededError(
			buildBudgetMessage(projectUsage.ratio, providerLabel(provider), projectUsage.resetLabel, 'project'),
		);
	}

	if (userUsage && userUsage.ratio >= 1) {
		throw new BudgetExceededError(
			buildBudgetMessage(userUsage.ratio, providerLabel(provider), userUsage.resetLabel, 'user'),
		);
	}
}

type BudgetUsage = {
	budget: DBProjectProviderBudget;
	currentSpend: number;
	ratio: number;
	resetLabel: string;
	scope: 'project' | 'user';
};

function buildBudgetMessage(ratio: number, label: string, resetLabel: string, scope: 'project' | 'user'): string {
	const percent = Math.min(Math.round(ratio * 100), 100);
	const scopeLabel = scope === 'user' ? 'your personal' : `your ${label}`;
	return `You've used ${percent}% of ${scopeLabel} budget. It will reset ${resetLabel}.`;
}

async function resolveBudgetUsage(projectId: string, provider: LlmProvider): Promise<BudgetUsage | null> {
	const budget = await budgetQueries.getProviderBudget(projectId, provider);
	if (!budget || budget.limitUsd <= 0) {
		return null;
	}

	await budgetQueries.advanceStaleBudgetPeriods(projectId, provider);
	const currentSpend = await budgetQueries.getProviderCurrentSpend(projectId, provider);
	const ratio = currentSpend / budget.limitUsd;
	const period = budget.period as BudgetPeriod;
	const resetLabel = formatResetDate(getNextPeriodStart(period), period);

	return { budget, currentSpend, ratio, resetLabel, scope: 'project' };
}

async function resolveUserBudgetUsage(
	projectId: string,
	provider: LlmProvider,
	userId: string | undefined,
): Promise<BudgetUsage | null> {
	if (!userId) {
		return null;
	}

	const isEnabled = await hasFeature(LICENSE_FEATURES.userBudget);
	if (!isEnabled) {
		return null;
	}

	const budget = await budgetQueries.getProviderBudget(projectId, provider);
	if (!budget || !budget.perUserLimitUsd || budget.perUserLimitUsd <= 0) {
		return null;
	}

	await budgetQueries.advanceStaleBudgetPeriods(projectId, provider);
	const currentSpend = await budgetQueries.getUserProviderCurrentSpend(projectId, userId, provider);
	const ratio = currentSpend / budget.perUserLimitUsd;
	const period = budget.period as BudgetPeriod;
	const resetLabel = formatResetDate(getNextPeriodStart(period), period);

	return { budget, currentSpend, ratio, resetLabel, scope: 'user' };
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

	const allMembers = await projectQueries.listProjectMembersWithRoles(projectId);
	const admins = allMembers.filter((m) => m.role === 'admin');
	if (admins.length === 0) {
		return;
	}

	const claimed = await budgetQueries.claimBudgetNotification(budget);
	if (!claimed) {
		return;
	}

	const period = budget.period as BudgetPeriod;
	const label = providerLabel(budget.provider as LlmProvider);

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
