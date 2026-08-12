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
import { getProjectConfigLlm } from './llm';
import { logger } from './logger';
import type { ConfigProviderBudget } from './nao-config-llm';

export type BudgetStatus = { level: 'ok' | 'warning' | 'exceeded'; message: string | null };

export type BudgetSource = 'project' | 'config';

export type EffectiveProviderBudget = ConfigProviderBudget & {
	provider: LlmProvider;
	source: BudgetSource;
};

export async function getEffectiveProviderBudgets(projectId: string): Promise<EffectiveProviderBudget[]> {
	const [dbBudgets, configLlm] = await Promise.all([
		budgetQueries.getProjectProviderBudgets(projectId),
		getProjectConfigLlm(projectId),
	]);

	const byProvider = new Map<LlmProvider, EffectiveProviderBudget>();
	for (const budget of dbBudgets) {
		byProvider.set(budget.provider as LlmProvider, {
			provider: budget.provider as LlmProvider,
			limitUsd: budget.limitUsd,
			perUserLimitUsd: budget.perUserLimitUsd ?? null,
			period: budget.period as BudgetPeriod,
			source: 'project',
		});
	}
	for (const configured of configLlm?.providers ?? []) {
		if (configured.budget) {
			byProvider.set(configured.provider, {
				provider: configured.provider,
				limitUsd: configured.budget.limitUsd,
				perUserLimitUsd: configured.budget.perUserLimitUsd,
				period: configured.budget.period,
				source: 'config',
			});
		}
	}

	return [...byProvider.values()];
}

export async function checkBudgetStatus(
	projectId: string,
	provider: LlmProvider,
	userId?: string,
): Promise<BudgetStatus> {
	const usages = await resolveBudgetUsages(projectId, provider, userId);

	if (usages.length === 0 || usages.every((u) => u.ratio < WARNING_BUDGET_THRESHOLD)) {
		return { level: 'ok', message: null };
	}

	const worst = usages.reduce((highest, usage) => (usage.ratio > highest.ratio ? usage : highest));
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
	const usages = await resolveBudgetUsages(projectId, provider, userId);
	const projectUsage = usages.find((u) => u.scope === 'project');
	const userUsage = usages.find((u) => u.scope === 'user');

	if (projectUsage && projectUsage.ratio >= 1) {
		if (projectUsage.dbBudget) {
			await notifyAdminsOnBudgetLimitReached(
				projectId,
				projectUsage.dbBudget,
				projectUsage.currentSpend,
				projectUsage.resetLabel,
			).catch(() => {});
		}
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
	currentSpend: number;
	ratio: number;
	resetLabel: string;
	scope: 'project' | 'user';
	dbBudget: DBProjectProviderBudget | null;
};

function buildBudgetMessage(ratio: number, label: string, resetLabel: string, scope: 'project' | 'user'): string {
	const percent = Math.min(Math.round(ratio * 100), 100);
	const scopeLabel = scope === 'user' ? `your personal ${label}` : `your ${label}`;
	return `You've used ${percent}% of ${scopeLabel} budget. It will reset ${resetLabel}.`;
}

async function resolveBudgetUsages(
	projectId: string,
	provider: LlmProvider,
	userId: string | undefined,
): Promise<BudgetUsage[]> {
	const budgets = await getEffectiveProviderBudgets(projectId);
	const budget = budgets.find((b) => b.provider === provider);
	if (!budget) {
		return [];
	}

	const hasProjectLimit = budget.limitUsd > 0;
	const hasUserLimit =
		!!userId &&
		!!budget.perUserLimitUsd &&
		budget.perUserLimitUsd > 0 &&
		(await hasFeature(LICENSE_FEATURES.userBudget));

	if (!hasProjectLimit && !hasUserLimit) {
		return [];
	}

	const dbBudget = budget.source === 'project' ? await advanceAndFetchDbBudget(projectId, provider) : null;
	const { projectSpend, userSpend } = await budgetQueries.getProviderBudgetSpend(
		projectId,
		provider,
		budget.period,
		userId,
	);
	const resetLabel = formatResetDate(getNextPeriodStart(budget.period), budget.period);

	const usages: BudgetUsage[] = [];
	if (hasProjectLimit) {
		usages.push({
			currentSpend: projectSpend,
			ratio: projectSpend / budget.limitUsd,
			resetLabel,
			scope: 'project',
			dbBudget,
		});
	}
	if (hasUserLimit && budget.perUserLimitUsd) {
		usages.push({
			currentSpend: userSpend,
			ratio: userSpend / budget.perUserLimitUsd,
			resetLabel,
			scope: 'user',
			dbBudget,
		});
	}
	return usages;
}

async function advanceAndFetchDbBudget(
	projectId: string,
	provider: LlmProvider,
): Promise<DBProjectProviderBudget | null> {
	await budgetQueries.advanceStaleBudgetPeriods(projectId, provider);
	return budgetQueries.getProviderBudget(projectId, provider);
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
