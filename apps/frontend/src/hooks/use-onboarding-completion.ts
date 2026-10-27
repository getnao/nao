import { useQuery } from '@tanstack/react-query';

import { findWarehouseJobId, isOnboardingComplete, useOnboardingProgress } from '@/components/onboarding-progress';
import { useWarehouseProvisioningJob } from '@/components/tool-calls/request-warehouse-credentials';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { isOnboardingCompleteError, NEW_CHAT_ID } from '@/lib/ai';
import { trpc } from '@/main';

export function useOnboardingCompletion(chatId: string | undefined, enabled = true) {
	const { error } = useAgentContext();
	const progress = useOnboardingProgress();
	const messageWarehouseJobId = useAgentMessagesSelector(findWarehouseJobId);
	const currentProject = useQuery({
		...trpc.project.getCurrent.queryOptions(),
		staleTime: 0,
		refetchOnMount: 'always',
		enabled,
	});
	const canRestoreWarehouseJob = enabled && Boolean(chatId && chatId !== NEW_CHAT_ID);
	const activeWarehouseJob = useQuery({
		...trpc.onboarding.getActiveWarehouseProvisioningJob.queryOptions({
			onboardingChatId: canRestoreWarehouseJob ? chatId! : '',
		}),
		enabled: canRestoreWarehouseJob,
	});
	const warehouseJob = useWarehouseProvisioningJob(
		enabled ? (activeWarehouseJob.data?.id ?? messageWarehouseJobId) : null,
	);
	const warehouseReady = warehouseJob.data?.status === 'ready';
	const warehouseProvisioningActive = canRestoreWarehouseJob
		? activeWarehouseJob.isSuccess
			? activeWarehouseJob.data !== null
			: undefined
		: false;
	const rejectedByBackend = isOnboardingCompleteError(error);

	return {
		complete:
			rejectedByBackend ||
			isOnboardingComplete(currentProject.data != null, progress, warehouseReady, warehouseProvisioningActive),
		setupReportedComplete: rejectedByBackend || isOnboardingComplete(true, progress, warehouseReady),
		projectIsMissing: currentProject.isSuccess && currentProject.data === null,
		progress,
		warehouseJob,
	};
}
