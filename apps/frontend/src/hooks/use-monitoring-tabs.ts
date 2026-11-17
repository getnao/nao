import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { usePermissions } from '@/hooks/use-permissions';
import { getVisibleMonitoringTabs } from '@/lib/monitoring-tabs';
import { trpc } from '@/main';

export function useMonitoringTabs() {
	const { role } = usePermissions();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isAutomationsEnabled = config.data?.betaAutomationsEnabled === true;
	return useMemo(() => getVisibleMonitoringTabs({ role, isAutomationsEnabled }), [role, isAutomationsEnabled]);
}
