import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { ChatViewProvider } from '@/contexts/chat-view';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { getRunStatusBadgeVariant } from '@/lib/automation-runs';
import { requireAutomationsEnabled } from '@/lib/route-guards';
import { isNotFoundError } from '@/lib/trpc-error';
import { trpc } from '@/main';

const RUNNING_REFETCH_INTERVAL_MS = 1_500;

export const Route = createFileRoute('/_sidebar-layout/automations/$automationId_/runs/$runId')({
	beforeLoad: async () => {
		await requireAutomationsEnabled();
	},
	component: AutomationRunPage,
});

/** The thread of an automation run, read-only, for the people the automation is shared with. */
function AutomationRunPage() {
	const { automationId, runId } = Route.useParams();
	const runChat = useQuery(
		trpc.automation.getRunChat.queryOptions(
			{ automationId, runId },
			{
				refetchInterval: (query) =>
					query.state.data?.run.status === 'running' ? RUNNING_REFETCH_INTERVAL_MS : false,
			},
		),
	);

	if (runChat.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (!runChat.data) {
		return <RunUnavailable isNotFound={isNotFoundError(runChat.error)} onRetry={() => void runChat.refetch()} />;
	}

	const { automation, run, chat } = runChat.data;

	return (
		<ChatViewProvider expandOnError={true}>
			<ChatIdContext.Provider value={chat.id}>
				<ReadonlyAgentMessagesProvider messages={chat.messages} chatId={chat.id}>
					<div className='flex flex-col flex-1 min-w-0 bg-background'>
						<header className='flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2.5 md:px-6'>
							<Button variant='ghost' size='icon-sm' asChild>
								<Link
									to='/automations/$automationId'
									params={{ automationId }}
									aria-label='Back to automation'
								>
									<ArrowLeft className='size-4' />
								</Link>
							</Button>
							<h1 className='text-base font-medium truncate'>{automation.title}</h1>
							<span className='text-sm text-muted-foreground shrink-0'>
								{new Date(run.startedAt).toLocaleString()}
							</span>
							<Badge variant={getRunStatusBadgeVariant(run.status)} className='ml-auto shrink-0'>
								{run.status}
							</Badge>
						</header>
						{run.errorMessage && (
							<p className='border-b px-4 py-2 text-xs text-destructive md:px-6'>{run.errorMessage}</p>
						)}
						<div className='relative flex-1 min-h-0 min-w-0'>
							<ChatMessagesReadonly className='h-full' messages={chat.messages} showTimestamps />
						</div>
					</div>
				</ReadonlyAgentMessagesProvider>
			</ChatIdContext.Provider>
		</ChatViewProvider>
	);
}

function RunUnavailable({ isNotFound, onRetry }: { isNotFound: boolean; onRetry: () => void }) {
	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-3'>
			<p className='text-sm text-muted-foreground'>{isNotFound ? 'Run not found.' : "Couldn't load this run."}</p>
			{!isNotFound && (
				<Button variant='outline' size='sm' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}
