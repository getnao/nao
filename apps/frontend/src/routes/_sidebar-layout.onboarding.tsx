import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Github, HelpCircle, KeyRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ChatInput } from '@/components/chat-input';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { MobileHeader } from '@/components/mobile-header';
import { OnboardingProgress, useOnboardingProgress } from '@/components/onboarding-progress';
import { GitHubRepoPicker } from '@/components/settings/github-repo-picker';
import { ImportProviderCard } from '@/components/settings/import-provider-card';
import { DeployKeyGenerator } from '@/components/settings/org-api-keys';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { AgentProvider, useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { StoryBeforeAgentSendProvider } from '@/contexts/story-before-agent-send';
import { getOnboardingChatIdStorage } from '@/hooks/use-agent';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { useHeight } from '@/hooks/use-height';
import { usePermissions } from '@/hooks/use-permissions';
import { setActiveProjectId } from '@/lib/active-project';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/onboarding')({
	validateSearch: (search: Record<string, unknown>): { github?: 'connected' } => ({
		github: search.github === 'connected' ? 'connected' : undefined,
	}),
	component: OnboardingRoute,
});

function OnboardingRoute() {
	const { data: session } = useSession();
	const chatId = session?.user.id ? (getOnboardingChatIdStorage(session.user.id).get() ?? undefined) : undefined;
	return (
		<ChatIdContext.Provider value={chatId}>
			<SetChatInputCallbackProvider>
				<StoryBeforeAgentSendProvider>
					<AgentProvider disableNavigation mode='onboarding'>
						<OnboardingPage />
					</AgentProvider>
				</StoryBeforeAgentSendProvider>
			</SetChatInputCallbackProvider>
		</ChatIdContext.Provider>
	);
}

function OnboardingPage() {
	const messages = useAgentMessages();
	const { isRunning, queueOrSendMessage } = useAgentContext();
	const progress = useOnboardingProgress();
	const { isOrgAdmin } = usePermissions();
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const search = Route.useSearch();
	const inputAreaRef = useRef<HTMLDivElement>(null);
	const actionAreaRef = useRef<HTMLDivElement>(null);
	const githubConnectionReportedRef = useRef(false);
	const hasMessages = messages.length > 0;
	const inputAreaHeight = useHeight(inputAreaRef, [hasMessages]);
	const actionAreaHeight = useHeight(actionAreaRef, [progress?.flow, progress?.step]);
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
		refetchOnWindowFocus: 'always',
	});
	const showDeployKey = (progress?.flow === 'new' || progress?.flow === 'local') && progress.step === 3;
	const showImportProviderCard = progress?.flow === 'github' && (progress.step === 0 || progress.step === 1);
	const onboardingComplete = progress?.step === 4 || (progress?.flow === 'github' && progress.step === 2);
	const [deployDialogStyle, setDeployDialogStyle] = useState<React.CSSProperties>();
	const [latestPlaintextDeployKey, setLatestPlaintextDeployKey] = useState<string | null>(null);

	useEffect(() => {
		if (search.github !== 'connected' || !window.opener) {
			return;
		}

		window.opener.focus();
		window.close();
	}, [search.github]);

	useEffect(() => {
		if (
			progress?.flow !== 'github' ||
			progress.step !== 0 ||
			githubStatus.data?.connected !== true ||
			githubConnectionReportedRef.current
		) {
			return;
		}

		githubConnectionReportedRef.current = true;
		queueOrSendMessage({ text: 'GitHub is connected and ready to use.' }).catch(console.error);
	}, [githubStatus.data?.connected, progress?.flow, progress?.step, queueOrSendMessage]);

	useEffect(() => {
		if (!onboardingComplete || !session?.user.id) {
			return;
		}

		const refreshProjects = async () => {
			await queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() });
			const project = await queryClient.fetchQuery(trpc.project.getCurrent.queryOptions());
			if (!project) {
				return;
			}

			setActiveProjectId(project.id);
			await queryClient.invalidateQueries();
		};

		refreshProjects().catch(console.error);
	}, [onboardingComplete, queryClient, session?.user.id]);

	const alignDeployDialog = () => {
		const rect = actionAreaRef.current?.getBoundingClientRect();
		if (!rect) {
			return;
		}

		setDeployDialogStyle({
			top: 'auto',
			bottom: window.innerHeight - rect.bottom,
			left: rect.left,
			width: rect.width,
			maxWidth: rect.width,
			translate: 'none',
		});
	};

	return (
		<div
			className='relative flex h-full min-w-72 flex-1 flex-col justify-center overflow-hidden bg-background'
			style={
				{
					'--chat-input-height': `${inputAreaHeight + actionAreaHeight + (actionAreaHeight ? 8 : 0)}px`,
					'--onboarding-action-bottom': `${inputAreaHeight + 8}px`,
				} as React.CSSProperties
			}
		>
			<MobileHeader />
			<div className='shrink-0 pb-2 pt-4'>
				<div className='mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 md:px-4'>
					<OnboardingProgress />
					{showDeployKey && (
						<Dialog>
							<div
								ref={actionAreaRef}
								className='animate-fade-in-up absolute bottom-[var(--onboarding-action-bottom)] left-1/2 z-20 flex w-[calc(100%-1.5rem)] max-w-[calc(48rem-1.5rem)] -translate-x-1/2 flex-col items-start justify-between gap-4 rounded-2xl border-2 border-violet/40 bg-violet/15 p-5 shadow-lg shadow-violet/10 sm:flex-row sm:items-center md:w-[calc(100%-2rem)] md:max-w-[calc(48rem-2rem)]'
							>
								<div className='flex min-w-0 items-center gap-3'>
									<div className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet text-white shadow-sm'>
										<KeyRound className='size-5' />
									</div>
									<div className='min-w-0'>
										<div className='mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet'>
											Action required
										</div>
										<div className='font-medium'>Ready to deploy your project</div>
										<p className='text-xs text-muted-foreground'>
											Generate your organization key and copy the complete deploy command.
										</p>
									</div>
								</div>
								<DialogTrigger asChild>
									<Button
										onClick={alignDeployDialog}
										className='bg-violet text-white hover:bg-violet/90'
									>
										{isOrgAdmin ? 'Generate deploy key' : 'Deployment key required'}
									</Button>
								</DialogTrigger>
							</div>
							<DialogContent
								className='max-h-[85vh] translate-y-0 overflow-y-auto sm:max-w-2xl'
								style={deployDialogStyle}
							>
								<DialogHeader>
									<DialogTitle>Deploy your nao project</DialogTitle>
									<DialogDescription>
										{isOrgAdmin
											? 'Generate a key, then run the command from your nao project folder.'
											: 'An organization admin must generate the deploy key for you.'}
									</DialogDescription>
								</DialogHeader>
								{isOrgAdmin && (
									<DeployKeyGenerator
										deployUrl={window.location.origin}
										latestPlaintextKey={latestPlaintextDeployKey}
										onPlaintextKeyCreated={setLatestPlaintextDeployKey}
									/>
								)}
							</DialogContent>
						</Dialog>
					)}
					{showImportProviderCard && (
						<div
							ref={actionAreaRef}
							className='animate-fade-in-up absolute bottom-[var(--onboarding-action-bottom)] left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-[calc(48rem-1.5rem)] -translate-x-1/2 rounded-2xl border-2 border-violet/40 bg-violet/15 p-5 shadow-lg shadow-violet/10 md:w-[calc(100%-2rem)] md:max-w-[calc(48rem-2rem)]'
						>
							<div className='mb-4 flex items-center gap-3'>
								<div className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet text-white shadow-sm'>
									<Github className='size-5' />
								</div>
								<div>
									<div className='mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet'>
										Action required
									</div>
									<div className='font-medium'>Import your GitHub project</div>
								</div>
							</div>
							{githubAvailable.isPending ? (
								<p className='text-sm text-muted-foreground'>Checking GitHub availability…</p>
							) : githubAvailable.data ? (
								<ImportProviderCard
									providerLabel='GitHub'
									icon={Github}
									connectHref='/api/github/connect?returnTo=%2Fonboarding'
									connectTarget='github-oauth'
									resourceNounSingular='repository'
									resourceNounPlural='repositories'
									connected={githubStatus.data?.connected === true}
									className='border-violet/30 bg-violet/20'
									Picker={GitHubRepoPicker}
									onImported={(project) =>
										queueOrSendMessage({
											text: `GitHub repository imported successfully as "${project.projectName}".`,
										}).catch(console.error)
									}
								/>
							) : (
								<p className='text-sm text-muted-foreground'>
									GitHub OAuth is not configured for this nao instance.
								</p>
							)}
						</div>
					)}
				</div>
			</div>
			{hasMessages ? (
				<>
					<ChatMessages />
					<div className='pointer-events-none absolute inset-x-0 bottom-0 z-10 pt-8'>
						<div
							ref={inputAreaRef}
							className='pointer-events-auto bg-gradient-to-t from-background via-background via-70% to-transparent'
						>
							{onboardingComplete ? (
								<div className='flex flex-col items-center gap-2 pb-4'>
									<Button
										asChild
										className='rounded-full bg-violet text-white shadow-sm hover:bg-violet/90'
									>
										<Link to='/'>
											Start chatting
											<ArrowRight className='size-4' />
										</Link>
									</Button>
									<p className='text-center text-sm text-muted-foreground'>
										This onboarding conversation is complete.
									</p>
								</div>
							) : (
								<ChatInput variant='onboarding' />
							)}
						</div>
					</div>
				</>
			) : (
				<div className='flex flex-1 flex-col items-center justify-center gap-6 p-4'>
					<div className='max-w-2xl space-y-2 text-center'>
						<h1 className='font-borna text-2xl tracking-tight md:text-3xl'>Set up your nao project</h1>
						<p className='text-sm text-muted-foreground'>
							Tell the onboarding agent what you already have, and it will guide you from there.
						</p>
					</div>
					<div className='flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3'>
						<div className='flex items-start gap-2'>
							<HelpCircle className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
							<div className='flex flex-col gap-0.5'>
								<span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
									Quick question
								</span>
								<p className='text-sm leading-relaxed'>
									Would you like to set up a project or simply connect your database?
								</p>
							</div>
						</div>
						<div className='flex flex-wrap gap-2 pl-6'>
							<Button
								variant='outline'
								size='sm'
								disabled={isRunning}
								onClick={() => queueOrSendMessage({ text: 'Set up a project' }).catch(console.error)}
								className='h-auto min-h-7 rounded-2xl py-1'
							>
								Set up a project
							</Button>
							<Button
								variant='outline'
								size='sm'
								disabled={isRunning}
								onClick={() => queueOrSendMessage({ text: 'Connect database' }).catch(console.error)}
								className='h-auto min-h-7 rounded-2xl py-1'
							>
								Connect database
							</Button>
						</div>
						<p className='pl-6 text-xs text-muted-foreground'>
							Choose an option, or type your answer below.
						</p>
					</div>
					<ChatInput variant='onboarding' />
				</div>
			)}
		</div>
	);
}
