import { getCurrentPeriodStart, getNextPeriodStart } from '@nao/shared/date';
import { type LlmProvider, providerLabel, WARNING_BUDGET_THRESHOLD } from '@nao/shared/types';

import type { BudgetNotificationKey } from '../queries/budget.queries';
import * as budgetQueries from '../queries/budget.queries';
import * as notificationUnsubscribeQueries from '../queries/notification-unsubscribe.queries';
import * as projectQueries from '../queries/project.queries';
import { emailService } from '../services/email';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { notify } from '../services/notification.service';
import { buildUnsubscribeUrl, resolveUnsubscribeScope } from '../services/notification-unsubscribe';
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
	const resolved = await resolveBudgetUsages(projectId, provider, userId);
	if (!resolved) {
		return { level: 'ok', message: null };
	}

	void notifyOnExceededBudgets(projectId, resolved, userId).catch((error) =>
		logger.error(`Failed to send budget limit notification: ${String(error)}`, { source: 'system' }),
	);

	const { usages } = resolved;
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
	const resolved = await resolveBudgetUsages(projectId, provider, userId);
	if (!resolved) {
		return;
	}

	void notifyOnExceededBudgets(projectId, resolved, userId).catch((error) =>
		logger.error(`Failed to send budget limit notification: ${String(error)}`, { source: 'system' }),
	);

	const projectUsage = resolved.usages.find((u) => u.scope === 'project');
	const userUsage = resolved.usages.find((u) => u.scope === 'user');

	if (projectUsage && projectUsage.ratio >= 1) {
		throw new BudgetExceededError(
			buildBudgetMessage(projectUsage.ratio, providerLabel(provider), projectUsage.resetLabel, 'project'),
		);
	}

	if (userUsage && userUsage.ratio >= 1 && userId) {
		throw new BudgetExceededError(
			buildBudgetMessage(userUsage.ratio, providerLabel(provider), userUsage.resetLabel, 'user'),
		);
	}
}

async function notifyOnExceededBudgets(
	projectId: string,
	resolved: ResolvedBudget,
	userId: string | undefined,
): Promise<void> {
	const { budget, usages, periodStart } = resolved;
	const projectUsage = usages.find((u) => u.scope === 'project');
	const userUsage = usages.find((u) => u.scope === 'user');

	if (projectUsage && projectUsage.ratio >= 1) {
		await notifyAdminsOnBudgetLimitReached(
			projectId,
			budget,
			projectUsage.currentSpend,
			projectUsage.resetLabel,
			periodStart,
		);
	}

	if (userUsage && userUsage.ratio >= 1 && userId) {
		await notifyUserOnBudgetLimitReached(
			projectId,
			userId,
			budget,
			userUsage.currentSpend,
			userUsage.resetLabel,
			periodStart,
		);
	}
}

type BudgetUsage = {
	currentSpend: number;
	ratio: number;
	resetLabel: string;
	scope: 'project' | 'user';
};

type ResolvedBudget = {
	budget: EffectiveProviderBudget;
	usages: BudgetUsage[];
	/** Period start captured at resolution time; carried through so a delayed notify can't claim a later period. */
	periodStart: Date;
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
): Promise<ResolvedBudget | null> {
	const budgets = await getEffectiveProviderBudgets(projectId);
	const budget = budgets.find((b) => b.provider === provider);
	if (!budget) {
		return null;
	}

	const hasProjectLimit = budget.limitUsd > 0;
	const hasUserLimit =
		!!userId &&
		!!budget.perUserLimitUsd &&
		budget.perUserLimitUsd > 0 &&
		(await hasFeature(LICENSE_FEATURES.userBudget));

	const periodStart = getCurrentPeriodStart(budget.period);
	if (!hasProjectLimit && !hasUserLimit) {
		return { budget, usages: [], periodStart };
	}

	if (budget.source === 'project') {
		await budgetQueries.advanceStaleBudgetPeriods(projectId, provider);
	}
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
		});
	}
	if (hasUserLimit && budget.perUserLimitUsd) {
		usages.push({
			currentSpend: userSpend,
			ratio: userSpend / budget.perUserLimitUsd,
			resetLabel,
			scope: 'user',
		});
	}
	return { budget, usages, periodStart };
}

async function notifyAdminsOnBudgetLimitReached(
	projectId: string,
	budget: EffectiveProviderBudget,
	currentSpendUsd: number,
	resetLabel: string,
	periodStart: Date,
): Promise<void> {
	const key = budgetNotificationKey(projectId, budget, 'project', periodStart);
	if (!(await budgetQueries.claimBudgetNotification(key))) {
		return;
	}

	const allMembers = await projectQueries.listProjectMembersWithRoles(projectId);
	const admins = allMembers.filter((m) => m.role === 'admin');
	if (admins.length === 0) {
		await budgetQueries.releaseBudgetNotification(key).catch(() => {});
		return;
	}

	const label = providerLabel(budget.provider);

	try {
		if (emailService.isEnabled()) {
			await Promise.all(
				admins.map(async (admin) => {
					const scope = resolveUnsubscribeScope('email', 'budget');
					if (scope && (await notificationUnsubscribeQueries.isUnsubscribed(admin.id, scope))) {
						return;
					}
					await emailService.sendEmail(
						admin.email,
						buildBudgetLimitReachedEmail(
							admin,
							label,
							budget.limitUsd,
							currentSpendUsd,
							budget.period,
							resetLabel,
							scope ? buildUnsubscribeUrl(admin.id, scope) : undefined,
						),
					);
				}),
			);
		}

		await Promise.all(
			admins.map((admin) =>
				notify({
					userId: admin.id,
					projectId,
					category: 'budget',
					title: `${label} budget limit reached`,
					body: `Chat requests using ${label} are blocked until the budget resets ${resetLabel}.`,
					linkUrl: '/settings/project/budgets',
					channels: ['in_app'],
					payload: {
						provider: budget.provider,
						limitUsd: budget.limitUsd,
						currentSpendUsd,
						scope: 'project',
					},
				}),
			),
		);
	} catch (error) {
		await budgetQueries.releaseBudgetNotification(key).catch(() => {});
		logger.error(`Failed to send budget limit notification: ${String(error)}`, { source: 'system' });
	}
}

async function notifyUserOnBudgetLimitReached(
	projectId: string,
	userId: string,
	budget: EffectiveProviderBudget,
	currentSpendUsd: number,
	resetLabel: string,
	periodStart: Date,
): Promise<void> {
	const key = budgetNotificationKey(projectId, budget, `user:${userId}`, periodStart);
	if (!(await budgetQueries.claimBudgetNotification(key))) {
		return;
	}

	const label = providerLabel(budget.provider);

	try {
		await notify({
			userId,
			projectId,
			category: 'budget',
			title: `Your ${label} budget limit reached`,
			body: `Your personal ${label} budget is used up. Requests are blocked until it resets ${resetLabel}.`,
			linkUrl: '/settings/project/budgets',
			channels: ['in_app'],
			payload: { provider: budget.provider, limitUsd: budget.perUserLimitUsd, currentSpendUsd, scope: 'user' },
		});
	} catch (error) {
		await budgetQueries.releaseBudgetNotification(key).catch(() => {});
		logger.error(`Failed to send per-user budget limit notification: ${String(error)}`, { source: 'system' });
	}
}

function budgetNotificationKey(
	projectId: string,
	budget: EffectiveProviderBudget,
	scope: string,
	periodStart: Date,
): BudgetNotificationKey {
	return {
		projectId,
		provider: budget.provider,
		scope,
		periodStart,
	};
}

function formatResetDate(date: Date, period: BudgetPeriod): string {
	if (period === 'day') {
		return 'tomorrow';
	}
	return `on ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
}
