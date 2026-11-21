import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { LocalAgentExtraUsage, LocalAgentRateLimits, LocalAgentRateLimitWindow } from '@nao/shared/local-agent';

import { findClaudeExecutable } from './claude-executable';
import { withProbeSession } from './claude-probe';

type PlanRateLimits = NonNullable<SDKControlGetUsageResponse['rate_limits']>;
type PlanWindow = { utilization: number | null; resets_at: string | null } | null | undefined;

const WINDOW_LABELS = {
	five_hour: 'Current session (5 hours)',
	seven_day: 'Current week (all models)',
	seven_day_opus: 'Current week (Opus)',
	seven_day_sonnet: 'Current week (Sonnet)',
} as const satisfies Partial<Record<keyof PlanRateLimits, string>>;

/**
 * The plan limits Claude Code shows in `/usage`, read without starting a turn. The SDK marks this
 * call experimental, so only its documented windows are kept and any failure reads as an error.
 */
export async function readRateLimits(): Promise<LocalAgentRateLimits> {
	const claude = await findClaudeExecutable();
	if (!claude) {
		return { state: 'unavailable' };
	}
	try {
		const usage = await withProbeSession(claude, (session) =>
			session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
		);
		if (!usage.rate_limits_available || !usage.rate_limits) {
			return { state: 'unavailable' };
		}
		return {
			state: 'available',
			windows: listWindows(usage.rate_limits),
			extraUsage: readExtraUsage(usage.rate_limits),
		};
	} catch (error) {
		return { state: 'error', message: error instanceof Error ? error.message : String(error) };
	}
}

export function listWindows(rateLimits: PlanRateLimits): LocalAgentRateLimitWindow[] {
	const namedWindows = Object.entries(WINDOW_LABELS).flatMap(([key, label]) =>
		toWindow(label, rateLimits[key as keyof typeof WINDOW_LABELS]),
	);
	const modelWindows = (rateLimits.model_scoped ?? []).flatMap((window) =>
		toWindow(`Current week (${window.display_name})`, window),
	);
	return [...namedWindows, ...modelWindows];
}

function toWindow(label: string, window: PlanWindow): LocalAgentRateLimitWindow[] {
	return window ? [{ label, utilization: window.utilization, resetsAt: window.resets_at }] : [];
}

function readExtraUsage(rateLimits: PlanRateLimits): LocalAgentExtraUsage | null {
	const extraUsage = rateLimits.extra_usage;
	if (!extraUsage?.is_enabled) {
		return null;
	}
	return {
		monthlyLimit: extraUsage.monthly_limit,
		usedCredits: extraUsage.used_credits,
		utilization: extraUsage.utilization,
		currency: extraUsage.currency ?? null,
	};
}
