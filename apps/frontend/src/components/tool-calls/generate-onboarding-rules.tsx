import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useWarehouseProvisioningJob } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

import { FormError } from '@/components/ui/form-fields';
import { Spinner } from '@/components/ui/spinner';
import { useAgentContext } from '@/contexts/agent.provider';
import { getOnboardingChatIdStorage } from '@/hooks/use-agent';
import { setActiveProjectId } from '@/lib/active-project';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function GenerateOnboardingRulesToolCall({ toolPart }: ToolCallComponentProps<'generate_onboarding_rules'>) {
	const jobId = toolPart.output?.jobId ?? null;
	const job = useWarehouseProvisioningJob(jobId);
	const { isRunning } = useAgentContext();
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
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
		if (!projectId || !session?.user.id || isRunning || activatedProjectId.current === projectId) {
			return;
		}

		activatedProjectId.current = projectId;
		getOnboardingChatIdStorage(session.user.id).set(null);
		setActiveProjectId(projectId);
		void Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.organization.getProjects.queryKey() }),
		]).then(() => navigate({ to: '/' }));
	}, [isRunning, navigate, projectId, queryClient, session?.user.id]);

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
					{error ? 'Connection finalization failed' : 'Finalizing your connection'}
				</span>
			</div>
			{error && <FormError error={error} />}
		</div>
	);
}
