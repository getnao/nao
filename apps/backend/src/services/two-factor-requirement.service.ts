import * as twoFactorQueries from '../queries/two-factor.queries';
import type { TwoFactorGracePeriod } from '../types/two-factor';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest deadline across the user's organizations that require two-factor authentication. */
export async function getTwoFactorDeadline(userId: string): Promise<Date | null> {
	const gracePeriods = await twoFactorQueries.listUserTwoFactorGracePeriods(userId);
	const deadlines = gracePeriods.map(computeGracePeriodDeadline);
	return deadlines.length ? new Date(Math.min(...deadlines.map((deadline) => deadline.getTime()))) : null;
}

/** The grace period starts when the organization required it, the member joined, or an admin restarted it. */
export function computeGracePeriodDeadline(gracePeriod: TwoFactorGracePeriod): Date {
	const startedAt = Math.max(
		gracePeriod.requiredAt.getTime(),
		gracePeriod.memberSince.getTime(),
		gracePeriod.graceRestartedAt?.getTime() ?? 0,
	);
	return new Date(startedAt + gracePeriod.gracePeriodDays * DAY_MS);
}
