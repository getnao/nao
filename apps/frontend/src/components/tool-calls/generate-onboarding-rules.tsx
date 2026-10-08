import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useWarehouseProvisioningJob } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

import { FormError } from '@/components/ui/form-fields';
import { Spinner } from '@/components/ui/spinner';
import { useAgentContext } from '@/contexts/agent.provider';
import { setActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

export function GenerateOnboardingRulesToolCall({ toolPart }: ToolCallComponentProps<'generate_onboarding_rules'>) {
	const jobId = toolPart.output?.jobId ?? null;
	const job = useWarehouseProvisioningJob(jobId);
	const { chatId, isRunning } = useAgentContext();
	const queryClient = useQueryClient();
	const activatedProjectId = useRef<string | null>(null);
	const projectId = job.data?.status === 'ready' ? job.data.projectId : undefined;
	const error =
		toolPart.errorText ??
		(job.isError ? job.error.message : undefined) ??
		(job.data?.status === 'failed'
			? job.data.error
			: job.data?.status === 'cancelled'
				? 'Warehouse setup was cancelled.'
				: undefined);
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
			queryClient.invalidateQueries({ queryKey: trpc.organization.getProjects.queryKey() }),
		]);
	}, [isRunning, projectId, queryClient]);

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-center gap-2 text-sm'>
				{error ? (
					<AlertCircle className='size-3 text-destructive' />
				) : isFinalizing ? (
					<Spinner className='size-3' />
				) : (
					<CheckCircle2 className='size-3 text-emerald-500' />
				)}
				<span className={isFinalizing ? 'text-shimmer' : undefined}>
					{error
						? 'Connection finalization failed'
						: isFinalizing
							? 'Finalizing your connection'
							: 'Connection ready'}
				</span>
			</div>
			{error && <FormError error={error} />}
		</div>
	);
}
