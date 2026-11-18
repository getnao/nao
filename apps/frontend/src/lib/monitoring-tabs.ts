import type { UserRole } from '@nao/shared/types';

export type MonitoringTabId = 'automations';

export type MonitoringTabPath = '/settings/monitoring/automations';

export interface MonitoringTab {
	id: MonitoringTabId;
	label: string;
	to: MonitoringTabPath;
	isVisible: (context: MonitoringAccessContext) => boolean;
}

export interface MonitoringAccessContext {
	role: UserRole | undefined;
	isAutomationsEnabled: boolean;
}

export const MONITORING_TABS: MonitoringTab[] = [
	{
		id: 'automations',
		label: 'Automations',
		to: '/settings/monitoring/automations',
		isVisible: ({ role, isAutomationsEnabled }) => role === 'admin' && isAutomationsEnabled,
	},
];

export function getVisibleMonitoringTabs(context: MonitoringAccessContext): MonitoringTab[] {
	return MONITORING_TABS.filter((monitoringTab) => monitoringTab.isVisible(context));
}

/** Matches the deepest tab whose path prefixes the current location, so nested pages keep their tab active. */
export function findActiveMonitoringTab(pathname: string, tabs: MonitoringTab[]): MonitoringTab | undefined {
	const normalizedPath = pathname.replace(/\/+$/, '');
	return [...tabs]
		.sort((left, right) => right.to.length - left.to.length)
		.find(
			(monitoringTab) => normalizedPath === monitoringTab.to || normalizedPath.startsWith(`${monitoringTab.to}/`),
		);
}
