import type { BudgetPeriod } from './types';

export function getCurrentPeriodStart(period: BudgetPeriod): Date {
	const now = new Date();
	switch (period) {
		case 'day':
			return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		case 'week': {
			const dayOfWeek = now.getUTCDay();
			const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
			return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
		}
		case 'month':
			return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	}
}

export function getNextPeriodStart(period: BudgetPeriod): Date {
	const start = getCurrentPeriodStart(period);
	switch (period) {
		case 'day':
			return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
		case 'week':
			return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7));
		case 'month':
			return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
	}
}
