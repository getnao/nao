import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import type { LlmProvider } from '@nao/shared/types';

import { RecommendationCard } from '@/components/recommendation-card';
import { RecommendationRepoCard } from '@/components/recommendation-repo-card';
import { SidePanel } from '@/components/side-panel/side-panel';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SidePanelProvider } from '@/contexts/side-panel';
import { useSidePanel } from '@/hooks/use-side-panel';
import { requireAdmin } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/recommendations')({
	beforeLoad: requireAdmin,
	component: RecommendationsPage,
});

const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const FREQUENCY_OPTIONS = [
	{ value: 'daily', label: 'Daily' },
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'monthly', label: 'Monthly' },
] as const;

type Frequency = (typeof FREQUENCY_OPTIONS)[number]['value'];

const MAX_AUTO_PR_OPTIONS = [1, 2, 3, 5, 10] as const;
const DEFAULT_MAX_AUTO_PRS = 3;
const MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH = 4000;

/** The job runs at 03:00 UTC; render that moment in the viewer's local timezone (display only). */
function localRunTime(): string {
	const at = new Date();
	at.setUTCHours(3, 0, 0, 0);
	return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function RecommendationsPage() {
	const queryClient = useQueryClient();
	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const [customSystemPromptInstructions, setCustomSystemPromptInstructions] = useState('');
	const [customSystemPromptInstructionsEnabled, setCustomSystemPromptInstructionsEnabled] = useState(false);
	const sidePanel = useSidePanel({
		containerRef,
		sidePanelRef,
		defaultWidthRatio: 0.5,
		shouldCollapseSidebar: false,
	});
	const systemConfig = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isEnabled = systemConfig.data?.betaContextRecommendationsEnabled === true;
	const recommendations = useQuery({ ...trpc.contextRecommendation.list.queryOptions({}), enabled: isEnabled });
	const latestRun = useQuery({
		...trpc.contextRecommendation.latestRun.queryOptions(),
		enabled: isEnabled,
		refetchInterval: (query) => (query.state.data?.status === 'running' ? 3000 : false),
	});
	const availableModels = useQuery({
		...trpc.contextRecommendation.listAvailableModels.queryOptions(),
		enabled: isEnabled,
	});
	const config = useQuery({ ...trpc.contextRecommendation.getConfig.queryOptions(), enabled: isEnabled });

	const setConfig = useMutation(trpc.contextRecommendation.setConfig.mutationOptions());
	const setStatus = useMutation(trpc.contextRecommendation.setStatus.mutationOptions());
	const run = useMutation(trpc.contextRecommendation.run.mutationOptions());

	const isRunning = run.isPending || latestRun.data?.status === 'running';

	const handleRun = async () => {
		await run.mutateAsync();
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.latestRun.queryKey() });
	};

	const previousRunStatus = useRef(latestRun.data?.status);
	useEffect(() => {
		const status = latestRun.data?.status;
		if (previousRunStatus.current === 'running' && status && status !== 'running') {
			queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.list.queryKey({}) });
		}
		previousRunStatus.current = status;
	}, [latestRun.data?.status, queryClient]);

	const selectedModelValue =
		config.data?.modelProvider && config.data?.modelId
			? `${config.data.modelProvider}:${config.data.modelId}`
			: undefined;

	const handleModelChange = async (value: string) => {
		const [provider, ...rest] = value.split(':');
		await setConfig.mutateAsync({ modelProvider: provider as LlmProvider, modelId: rest.join(':') });
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
	};

	const selectedFrequency: Frequency = config.data?.frequency ?? 'weekly';
	const activeRecommendations = recommendations.data?.filter((rec) => rec.status === 'open') ?? [];
	const handledRecommendations = recommendations.data?.filter((rec) => rec.status !== 'open') ?? [];
	const savedCustomSystemPromptInstructions = config.data?.customSystemPromptInstructions ?? '';
	const hasCustomSystemPromptInstructionsChanges =
		customSystemPromptInstructions.trim() !== savedCustomSystemPromptInstructions.trim();

	useEffect(() => {
		setCustomSystemPromptInstructions(savedCustomSystemPromptInstructions);
		setCustomSystemPromptInstructionsEnabled(savedCustomSystemPromptInstructions.trim().length > 0);
	}, [savedCustomSystemPromptInstructions]);

	const handleFrequencyChange = async (value: string) => {
		await setConfig.mutateAsync({ frequency: value as Frequency });
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
	};

	const yoloEnabled = config.data?.autoCreatePrs === true;
	const maxAutoPrs = config.data?.maxAutoPrsPerRun ?? DEFAULT_MAX_AUTO_PRS;

	const handleYoloChange = async (checked: boolean) => {
		await setConfig.mutateAsync({ autoCreatePrs: checked });
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
	};

	const handleMaxAutoPrsChange = async (value: string) => {
		await setConfig.mutateAsync({ maxAutoPrsPerRun: Number(value) });
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
	};

	const handleCustomSystemPromptInstructionsSave = async () => {
		if (!hasCustomSystemPromptInstructionsChanges) {
			return;
		}
		await setConfig.mutateAsync({
			customSystemPromptInstructions: customSystemPromptInstructions.trim(),
		});
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
	};

	const handleCustomSystemPromptInstructionsEnabledChange = async (checked: boolean) => {
		setCustomSystemPromptInstructionsEnabled(checked);

		if (checked) {
			return;
		}

		if (!savedCustomSystemPromptInstructions.trim()) {
			setCustomSystemPromptInstructions('');
			return;
		}

		try {
			await setConfig.mutateAsync({ customSystemPromptInstructions: '' });
			setCustomSystemPromptInstructions('');
			queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
		} catch {
			// Keep the saved instructions and re-open the section so nothing is lost on a failed save.
			setCustomSystemPromptInstructionsEnabled(true);
		}
	};

	const changeStatus = async (id: string, status: 'acknowledged' | 'snoozed' | 'applied' | 'dismissed') => {
		await setStatus.mutateAsync({
			id,
			status,
			snoozedUntil: status === 'snoozed' ? Date.now() + SNOOZE_MS : undefined,
		});
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.list.queryKey({}) });
	};

	if (systemConfig.data && !isEnabled) {
		return (
			<SettingsPageWrapper>
				<SettingsCard
					title='Context Recommendations'
					titleSize='lg'
					description="Diagnostic suggestions for improving this project's context, mined from real usage."
				>
					<Empty className='whitespace-normal'>
						This feature is currently in beta. To enable it, set the environment variable{' '}
						<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs'>
							BETA_CONTEXT_RECOMMENDATIONS_ENABLED=true
						</code>{' '}
						on your nao instance and restart it.
					</Empty>
				</SettingsCard>
			</SettingsPageWrapper>
		);
	}

	return (
		<SidePanelProvider
			isVisible={sidePanel.isVisible}
			currentStorySlug={sidePanel.currentStorySlug}
			chatId={null}
			open={sidePanel.open}
			close={sidePanel.close}
		>
			<div ref={containerRef} className='flex h-full min-h-0'>
				<SettingsPageWrapper>
					<SettingsCard
						title='Context Recommendations'
						titleSize='lg'
						description="Diagnostic suggestions for improving this project's context, mined from real usage."
						action={
							<div className='flex flex-col items-end gap-1'>
								<Button size='sm' onClick={handleRun} disabled={isRunning}>
									{isRunning && <Spinner className='size-4' />}
									{isRunning ? 'Running…' : 'Run now'}
								</Button>
								{latestRun.data ? (
									<span className='text-xs text-muted-foreground italic'>
										Latest {new Date(latestRun.data.startedAt).toLocaleString()}
									</span>
								) : (
									<span className='text-xs text-muted-foreground italic'>Never run</span>
								)}
							</div>
						}
					>
						<div className='flex flex-col gap-4'>
							<div className='flex items-center justify-between gap-4'>
								<div className='text-sm'>Analysis model</div>
								<div className='w-72'>
									<Select
										value={selectedModelValue}
										onValueChange={handleModelChange}
										disabled={setConfig.isPending}
									>
										<SelectTrigger className='w-full'>
											<SelectValue placeholder='Project default' />
										</SelectTrigger>
										<SelectContent>
											{availableModels.data?.map((m) => (
												<SelectItem
													key={`${m.provider}:${m.modelId}`}
													value={`${m.provider}:${m.modelId}`}
												>
													<div className='flex items-center gap-2'>
														<LlmProviderIcon provider={m.provider} className='size-4' />
														{m.name}
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className='flex items-center justify-between gap-4'>
								<div>
									<div className='text-sm'>Run frequency</div>
									<div className='text-xs text-muted-foreground'>
										Runs at {localRunTime()} your time
									</div>
								</div>
								<div className='w-72'>
									<Select
										value={selectedFrequency}
										onValueChange={handleFrequencyChange}
										disabled={setConfig.isPending}
									>
										<SelectTrigger className='w-full'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{FREQUENCY_OPTIONS.map((f) => (
												<SelectItem key={f.value} value={f.value}>
													{f.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className='flex flex-col gap-2'>
								<div className='flex items-center justify-between gap-4'>
									<div>
										<div className='text-sm'>Custom system prompt instructions</div>
										<div className='text-xs text-muted-foreground'>
											Added to every context recommendations run after the built-in audit
											instructions.
										</div>
									</div>
									<Switch
										checked={customSystemPromptInstructionsEnabled}
										onCheckedChange={handleCustomSystemPromptInstructionsEnabledChange}
										disabled={setConfig.isPending}
									/>
								</div>
								{customSystemPromptInstructionsEnabled && (
									<>
										<Textarea
											value={customSystemPromptInstructions}
											onChange={(event) => setCustomSystemPromptInstructions(event.target.value)}
											placeholder='Example: Prioritize recommendations that improve revenue metric definitions.'
											maxLength={MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH}
											disabled={setConfig.isPending}
											className='min-h-28 resize-y'
										/>
										<div className='flex items-center justify-between gap-4'>
											<div className='text-xs text-muted-foreground'>
												{customSystemPromptInstructions.length}/
												{MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH} characters
											</div>
											<Button
												size='sm'
												variant='outline'
												onClick={handleCustomSystemPromptInstructionsSave}
												disabled={
													setConfig.isPending || !hasCustomSystemPromptInstructionsChanges
												}
											>
												Save
											</Button>
										</div>
									</>
								)}
							</div>

							<div className='flex items-center justify-between gap-4'>
								<div>
									<div className='text-sm'>YOLO mode</div>
									<div className='text-xs text-muted-foreground'>
										Open pull requests automatically after each run, without human review.
										Recommendations with a PR are marked as applied.
									</div>
								</div>
								<Switch
									checked={yoloEnabled}
									onCheckedChange={handleYoloChange}
									disabled={setConfig.isPending}
								/>
							</div>

							{yoloEnabled && (
								<div className='flex items-center justify-between gap-4'>
									<div>
										<div className='text-sm'>Max pull requests per run</div>
										<div className='text-xs text-muted-foreground'>
											Highest-impact recommendations go first
										</div>
									</div>
									<div className='w-72'>
										<Select
											value={String(maxAutoPrs)}
											onValueChange={handleMaxAutoPrsChange}
											disabled={setConfig.isPending}
										>
											<SelectTrigger className='w-full'>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{MAX_AUTO_PR_OPTIONS.map((n) => (
													<SelectItem key={n} value={String(n)}>
														{n === 1 ? '1 pull request' : `${n} pull requests`}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>
							)}
						</div>
					</SettingsCard>

					<RecommendationRepoCard />

					<SettingsCard
						title='Recommendations'
						description='Ranked by impact. Act on each, then re-run to refresh.'
					>
						{recommendations.isLoading ? (
							<div className='flex justify-center p-4'>
								<Spinner />
							</div>
						) : recommendations.isError && !recommendations.data ? (
							<Empty>
								Failed to load recommendations: {recommendations.error?.message ?? 'unknown error'}
							</Empty>
						) : !recommendations.data || recommendations.data.length === 0 ? (
							<Empty>No recommendations yet. They appear after the next analysis run.</Empty>
						) : (
							<div className='flex flex-col gap-3'>
								{activeRecommendations.length > 0 ? (
									activeRecommendations.map((rec) => (
										<RecommendationCard
											key={rec.id}
											recommendation={rec}
											onChangeStatus={changeStatus}
											isPending={setStatus.isPending}
										/>
									))
								) : (
									<Empty>No open recommendations.</Empty>
								)}
							</div>
						)}
					</SettingsCard>

					{handledRecommendations.length > 0 && (
						<>
							<div className='flex items-center gap-3 text-xs font-medium text-muted-foreground'>
								<span className='h-px flex-1 bg-border' />
								Already treated ({handledRecommendations.length})
								<span className='h-px flex-1 bg-border' />
							</div>
							<SettingsCard>
								<div className='flex flex-col gap-3'>
									{handledRecommendations.map((rec) => (
										<RecommendationCard
											key={rec.id}
											recommendation={rec}
											onChangeStatus={changeStatus}
											isPending={setStatus.isPending}
											defaultCollapsed
										/>
									))}
								</div>
							</SettingsCard>
						</>
					)}
				</SettingsPageWrapper>

				{sidePanel.content && (
					<SidePanel
						containerRef={containerRef}
						isAnimating={sidePanel.isAnimating}
						sidePanelRef={sidePanelRef}
						resizeHandleRef={sidePanel.resizeHandleRef}
						onClose={sidePanel.close}
					>
						{sidePanel.content}
					</SidePanel>
				)}
			</div>
		</SidePanelProvider>
	);
}
