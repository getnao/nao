import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { OnboardingStatusLine } from './onboarding-status-line';
import { useWarehouseProvisioningJob } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

import { useAgentContext } from '@/contexts/agent.provider';
import { useToolCallContext } from '@/contexts/tool-call';
import { setActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

export function GenerateOnboardingRulesToolCall({ toolPart }: ToolCallComponentProps<'generate_onboarding_rules'>) {
	const jobId = toolPart.output?.jobId ?? null;
	const job = useWarehouseProvisioningJob(jobId);
	const { chatId, isRunning } = useAgentContext();
	const queryClient = useQueryClient();
	const activatedProjectId = useRef<string | null>(null);
	const projectId = job.data?.status === 'ready' ? job.data.projectId : undefined;
	const { isSettled } = useToolCallContext();
	const missingSettledOutput = isSettled && !jobId && !toolPart.errorText;

	const error =
		toolPart.errorText ??
		(missingSettledOutput
			? 'Connection finalization was interrupted. Please try again.'
			: ((job.isError ? job.error.message : undefined) ??
				(job.data?.status === 'failed'
					? (job.data.error ?? 'Warehouse setup failed.')
					: job.data?.status === 'cancelled'
						? 'Warehouse setup was cancelled.'
						: undefined)));

	const isFinalizing = !error && job.data?.status !== 'ready';
	useEffect(() => {
		if (!chatId || !jobId) {
			return;
		}

		void queryClient.invalidateQueries({
			queryKey: trpc.onboarding.getActiveWarehouseProvisioningJob.queryKey({ onboardingChatId: chatId }),
		});
	}, [chatId, jobId, queryClient]);

	useEffect(() => {
		if (!projectId || isRunning || activatedProjectId.current === projectId) {
			return;
		}

		activatedProjectId.current = projectId;
		setActiveProjectId(projectId);
		void Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.project.isCurrentSetupComplete.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.organization.getProjects.queryKey() }),
		]);
	}, [isRunning, projectId, queryClient]);

	if (error) {
		return <OnboardingStatusLine tone='error' label='Project setup stopped' detail={error} />;
	}
	if (isFinalizing) {
		return null;
	}
	return <OnboardingStatusLine tone='success' label='Project ready' />;
}
