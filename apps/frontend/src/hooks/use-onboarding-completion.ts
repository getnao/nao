import { useQuery } from '@tanstack/react-query';

import {
	canFinishDeployOnboarding,
	findCreatedOnboardingProject,
	findWarehouseJobId,
	hasOnboardingCloudAccess,
	isOnboardingComplete,
	useOnboardingProgress,
} from '@/components/onboarding-progress';
import { useWarehouseProvisioningJob } from '@/components/tool-calls/request-warehouse-credentials';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { useActiveProjectId } from '@/lib/active-project';
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
	const projectSetupComplete = useQuery({
		...trpc.project.isCurrentSetupComplete.queryOptions(),
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
	const deployFlow = progress?.flow === 'new' || progress?.flow === 'local';
	const activeProjectId = useActiveProjectId();
	const isSavedChat = enabled && Boolean(chatId && chatId !== NEW_CHAT_ID);
	const onboardingChat = useQuery({
		...trpc.chat.get.queryOptions({ chatId: isSavedChat ? chatId! : '' }),
		enabled: deployFlow && isSavedChat,
	});
	const projects = useQuery({
		...trpc.project.listForCurrentUser.queryOptions(),
		enabled: enabled && deployFlow,
	});
	const config = useQuery({
		...trpc.system.getPublicConfig.queryOptions(),
		enabled: enabled && deployFlow,
	});
	const billingAccess = useCloudBillingAccess({
		enabled: enabled && deployFlow && config.data?.cloudBillingEnabled === true,
		pollWhileRestricted: true,
	});
	const deployedProject = findCreatedOnboardingProject(projects.data, onboardingChat.data?.createdAt);
	const deployedProjectReady =
		deployedProject !== null && activeProjectId === deployedProject.id && projectSetupComplete.data === true;
	const hasCloudAccess =
		config.isSuccess && hasOnboardingCloudAccess(config.data.cloudBillingEnabled === true, billingAccess.data);
	const milestoneComplete = isOnboardingComplete(
		deployFlow ? deployedProjectReady : projectSetupComplete.data === true,
		progress,
		warehouseReady,
		warehouseProvisioningActive,
	);

	return {
		complete:
			rejectedByBackend ||
			(deployFlow
				? canFinishDeployOnboarding(
						deployedProjectReady,
						hasCloudAccess,
						progress,
						warehouseReady,
						warehouseProvisioningActive,
					)
				: milestoneComplete),
		setupReportedComplete: rejectedByBackend || isOnboardingComplete(true, progress, warehouseReady),
		projectIsMissing: currentProject.isSuccess && currentProject.data === null,
		progress,
		warehouseJob,
	};
}
