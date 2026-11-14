import { joinWithAnd } from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';

import GithubIcon from '@/components/icons/github-icon.svg';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { DeploymentManagedGitSettings } from '@/components/settings/deployment-managed-git-settings';
import { GithubRepoList } from '@/components/settings/github-repo-list';
import { GithubSharedTokenForm, GithubSharedTokenSummary } from '@/components/settings/github-shared-token-settings';
import { GitlabRepoList } from '@/components/settings/gitlab-repo-list';
import { LiveContextUpdateSettings } from '@/components/settings/live-context-update-settings';
import { ConnectedProviderAccount, ProviderConnectionCard } from '@/components/settings/provider-connection-card';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { usePermissions } from '@/hooks/use-permissions';
import { requireContextAdminOrAdmin } from '@/lib/route-guards';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/git')({
	beforeLoad: requireContextAdminOrAdmin,
	component: GitSettingsPage,
});

type GitProvider = 'github' | 'gitlab';

type GithubAccessMethod = 'shared-token' | 'personal-accounts';

const GITHUB_ACCESS_METHODS: { id: GithubAccessMethod; label: string; description: string }[] = [
	{
		id: 'shared-token',
		label: 'Shared access token',
		description: 'One GitHub account, such as a bot, commits and opens pull requests for everyone.',
	},
	{
		id: 'personal-accounts',
		label: 'Personal accounts',
		description: 'Each person signs in with their own GitHub account through a GitHub OAuth App.',
	},
];

interface RepositoryListProps {
	selected: string | null;
	onSelect: (repositoryName: string) => void;
}

interface ProviderConfig {
	label: string;
	icon: ComponentType<{ className?: string }>;
	connectHref: string;
	repositoryList: ComponentType<RepositoryListProps>;
	clientIdEnvVar: string;
	clientSecretEnvVar: string;
	oauthAppName: string;
	oauthAppLocation: string;
	reviewRequestName: string;
	reviewRequestNamePlural: string;
}

interface ProviderSwitchRequest {
	targetProvider: GitProvider;
	sourceProvider: GitProvider;
	repositoryName: string | null;
	disconnectAccount: boolean;
	accountDisconnected: boolean;
}

const PROVIDER_CONFIGS: Record<GitProvider, ProviderConfig> = {
	github: {
		label: 'GitHub',
		icon: GithubIcon,
		connectHref: '/api/github/connect?returnTo=/settings/git',
		repositoryList: GithubRepoList,
		clientIdEnvVar: 'GITHUB_CLIENT_ID',
		clientSecretEnvVar: 'GITHUB_CLIENT_SECRET',
		oauthAppName: 'GitHub OAuth App',
		oauthAppLocation: "GitHub's Developer settings",
		reviewRequestName: 'pull request',
		reviewRequestNamePlural: 'pull requests',
	},
	gitlab: {
		label: 'GitLab',
		icon: GitlabIcon,
		connectHref: '/api/gitlab/connect?returnTo=/settings/git',
		repositoryList: GitlabRepoList,
		clientIdEnvVar: 'GITLAB_CLIENT_ID',
		clientSecretEnvVar: 'GITLAB_CLIENT_SECRET',
		oauthAppName: 'GitLab OAuth application',
		oauthAppLocation: "GitLab's Applications settings",
		reviewRequestName: 'merge request',
		reviewRequestNamePlural: 'merge requests',
	},
};

function GitSettingsPage() {
	const queryClient = useQueryClient();
	const { isAdmin } = usePermissions();
	const [selectedProviderOverride, setSelectedProviderOverride] = useState<GitProvider | null>(null);
	const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
	const [providerSwitchRequest, setProviderSwitchRequest] = useState<ProviderSwitchRequest | null>(null);
	const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
	const [isConfirmingRepository, setIsConfirmingRepository] = useState(false);
	const [isDisconnectingRepository, setIsDisconnectingRepository] = useState(false);
	const [showRecommendedSetup, setShowRecommendedSetup] = useState(false);
	const [githubAccessMethodOverride, setGithubAccessMethodOverride] = useState<GithubAccessMethod | null>(null);

	const repositoryStatus = useQuery(trpc.contextExplorer.getRepositoryStatus.queryOptions());
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const gitlabAvailable = useQuery(trpc.gitlab.isAvailable.queryOptions());
	const sharedToken = useQuery(trpc.github.getSharedAccessToken.queryOptions());
	const sharedTokenConfigured = sharedToken.data?.configured === true;
	const sharedTokenAccount = sharedToken.data?.configured ? sharedToken.data.account : null;
	const selectedProvider =
		selectedProviderOverride ??
		getDefaultProvider(
			repositoryStatus.data?.repo?.provider,
			githubAvailable.data === true || sharedTokenConfigured,
			gitlabAvailable.data === true,
		);
	const githubAccessMethod =
		githubAccessMethodOverride ??
		getDefaultGithubAccessMethod(sharedTokenConfigured, githubAvailable.data === true);
	const usesSharedToken = selectedProvider === 'github' && githubAccessMethod === 'shared-token';
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: selectedProvider === 'github' && !usesSharedToken && githubAvailable.data === true,
	});
	const gitlabStatus = useQuery({
		...trpc.gitlab.getStatus.queryOptions(),
		enabled: selectedProvider === 'gitlab' && gitlabAvailable.data === true,
	});

	const connectRepository = useMutation(
		trpc.contextExplorer.connectRepository.mutationOptions({
			onSuccess: async () => {
				await invalidateRepositoryQueries(queryClient);
				setIsConfirmingRepository(false);
				setSelectedRepository(null);
			},
		}),
	);
	const disconnectRepository = useMutation(
		trpc.contextExplorer.disconnectRepository.mutationOptions({
			onSuccess: async () => {
				await invalidateRepositoryQueries(queryClient);
				setIsDisconnectingRepository(false);
			},
		}),
	);
	const disconnectGithub = useMutation(
		trpc.github.disconnect.mutationOptions({
			onSuccess: async () => {
				await invalidateProviderAccountQueries(queryClient, 'github');
				setSelectedRepository(null);
			},
		}),
	);
	const disconnectGitlab = useMutation(
		trpc.gitlab.disconnect.mutationOptions({
			onSuccess: async () => {
				await invalidateProviderAccountQueries(queryClient, 'gitlab');
				setSelectedRepository(null);
			},
		}),
	);
	const handleDisconnectGithub = () => {
		disconnectGithub.reset();
		disconnectGithub.mutate();
	};
	const handleDisconnectGitlab = () => {
		disconnectGitlab.reset();
		disconnectGitlab.mutate();
	};

	const status = repositoryStatus.data;
	const providerConfig = PROVIDER_CONFIGS[selectedProvider];
	const githubAccount = usesSharedToken
		? sharedTokenAccount && { username: sharedTokenAccount.login, avatarUrl: sharedTokenAccount.avatarUrl }
		: githubStatus.data?.connected
			? { username: githubStatus.data.user.login, avatarUrl: githubStatus.data.user.avatarUrl }
			: null;
	const provider =
		selectedProvider === 'github'
			? {
					...providerConfig,
					id: selectedProvider,
					available: usesSharedToken ? sharedTokenAccount !== null : githubAvailable.data === true,
					account: githubAccount,
					disconnect: handleDisconnectGithub,
					disconnectPending: disconnectGithub.isPending,
					disconnectError: disconnectGithub.error,
				}
			: {
					...providerConfig,
					id: selectedProvider,
					available: gitlabAvailable.data === true,
					account: gitlabStatus.data?.connected
						? { username: gitlabStatus.data.user.username, avatarUrl: gitlabStatus.data.user.avatarUrl }
						: null,
					disconnect: handleDisconnectGitlab,
					disconnectPending: disconnectGitlab.isPending,
					disconnectError: disconnectGitlab.error,
				};
	const ProviderIcon = provider.icon;
	const RepositoryList = provider.repositoryList;
	const instanceReady = provider.available;
	const accountReady = provider.account !== null;
	const personalAccountReady = accountReady && !usesSharedToken;
	const repositoryProvider = status?.repo?.provider;
	const connectedRepositoryProvider = isGitProvider(repositoryProvider) ? repositoryProvider : null;
	const repositoryReady = connectedRepositoryProvider !== null;
	const showDeploymentPanel = status?.managedByContextSource === true && !repositoryReady;
	const canConnectRepository = instanceReady && accountReady && !repositoryReady;
	const repositoryDisconnectBlockedReason = getRepositoryDisconnectBlockedReason(isAdmin);
	const selectedAccountStatus = selectedProvider === 'github' ? githubStatus : gitlabStatus;
	const isLoading =
		repositoryStatus.isLoading ||
		githubAvailable.isLoading ||
		gitlabAvailable.isLoading ||
		sharedToken.isLoading ||
		(instanceReady && selectedAccountStatus.isLoading);
	const loadError =
		repositoryStatus.error ??
		githubAvailable.error ??
		gitlabAvailable.error ??
		sharedToken.error ??
		selectedAccountStatus.error;
	const providerSwitchError = disconnectRepository.error ?? provider.disconnectError;

	const toggleSelectedRepository = (fullName: string) => {
		setSelectedRepository(fullName === selectedRepository ? null : fullName);
	};

	const selectProvider = (nextProvider: GitProvider) => {
		setSelectedProviderOverride(nextProvider);
		setSelectedRepository(null);
		setIsConfirmingRepository(false);
	};

	const handleProviderSelect = (nextProvider: GitProvider) => {
		if (nextProvider === selectedProvider) {
			return;
		}
		if (repositoryReady && repositoryDisconnectBlockedReason) {
			return;
		}
		if (!repositoryReady && !personalAccountReady) {
			selectProvider(nextProvider);
			return;
		}
		disconnectRepository.reset();
		if (selectedProvider === 'github') {
			disconnectGithub.reset();
		} else {
			disconnectGitlab.reset();
		}
		setProviderSwitchRequest({
			targetProvider: nextProvider,
			sourceProvider: selectedProvider,
			repositoryName: repositoryReady ? (status?.repo?.repoFullName ?? null) : null,
			disconnectAccount: personalAccountReady,
			accountDisconnected: false,
		});
	};

	const handleConfirmProviderSwitch = async () => {
		if (!providerSwitchRequest) {
			return;
		}
		setIsSwitchingProvider(true);
		try {
			if (providerSwitchRequest.disconnectAccount && !providerSwitchRequest.accountDisconnected) {
				if (providerSwitchRequest.sourceProvider === 'github') {
					await disconnectGithub.mutateAsync();
				} else {
					await disconnectGitlab.mutateAsync();
				}
				setProviderSwitchRequest((request) => (request ? { ...request, accountDisconnected: true } : null));
			}
			if (providerSwitchRequest.repositoryName) {
				await disconnectRepository.mutateAsync();
			}
			selectProvider(providerSwitchRequest.targetProvider);
			setProviderSwitchRequest(null);
		} catch {
			return;
		} finally {
			setIsSwitchingProvider(false);
		}
	};

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Git</h1>
					<p className='text-sm text-muted-foreground'>
						Manage the repository and accounts used to edit context files and open review requests.
					</p>
				</div>
				<div className='flex flex-col gap-12'>
					<SettingsCard unstyled className='gap-10'>
						{isLoading ? (
							<div className='flex items-center justify-center py-10'>
								<Spinner />
							</div>
						) : loadError ? (
							<div className='flex flex-col items-start gap-2'>
								<ErrorMessage message={loadError.message} />
								<Button
									size='sm'
									variant='outline'
									onClick={() => {
										void repositoryStatus.refetch();
										void githubAvailable.refetch();
										void gitlabAvailable.refetch();
										void sharedToken.refetch();
										if (instanceReady) {
											void selectedAccountStatus.refetch();
										}
									}}
								>
									Retry
								</Button>
							</div>
						) : (
							<>
								{showDeploymentPanel && (
									<DeploymentManagedGitSettings
										contextSource={status.contextSource}
										configurationError={status.liveContextUpdate.configurationError}
										recommendedSetupVisible={showRecommendedSetup}
										onToggleRecommendedSetup={() => {
											setShowRecommendedSetup((visible) => !visible);
										}}
									/>
								)}
								{(!showDeploymentPanel || showRecommendedSetup) && (
									<div id='recommended-git-setup' className='contents'>
										<NumberedSetupSection
											number={1}
											title={
												usesSharedToken
													? 'GitHub access token'
													: `${provider.label} server keys`
											}
											ownership={
												usesSharedToken
													? 'Done by a project admin, once for everyone.'
													: 'Done by the admin who deploys nao, once for everyone.'
											}
											isDone={instanceReady}
											completedContent={
												usesSharedToken ? (
													<GithubSharedTokenSummary
														account={sharedTokenAccount}
														error={null}
														canEdit={isAdmin}
													/>
												) : undefined
											}
											persistentContent={
												<div className='space-y-3'>
													<ProviderSelector
														selectedProvider={selectedProvider}
														switchBlockedReason={
															repositoryReady ? repositoryDisconnectBlockedReason : null
														}
														onSelect={handleProviderSelect}
													/>
													{selectedProvider === 'github' && (
														<GithubAccessMethodSelector
															selectedMethod={githubAccessMethod}
															switchBlockedReason={
																sharedTokenConfigured
																	? 'Remove the access token to use personal accounts instead.'
																	: null
															}
															onSelect={setGithubAccessMethodOverride}
														/>
													)}
												</div>
											}
										>
											{!instanceReady && usesSharedToken && (
												<div className='space-y-4'>
													{sharedToken.data?.configured && (
														<GithubSharedTokenSummary
															account={null}
															error={sharedToken.data.error}
															canEdit={isAdmin}
														/>
													)}
													<GithubSharedTokenForm canEdit={isAdmin} />
												</div>
											)}
											{!instanceReady && !usesSharedToken && (
												<div className='space-y-2 text-sm text-muted-foreground'>
													<p>
														Create a {provider.oauthAppName} in {provider.oauthAppLocation},
														then set{' '}
														<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground'>
															{provider.clientIdEnvVar}
														</code>{' '}
														and{' '}
														<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground'>
															{provider.clientSecretEnvVar}
														</code>{' '}
														on the server. If you run this instance, you can set them now.
														Otherwise ask your admin.
													</p>
													<p>
														After setting the server keys, redeploy or restart nao for them
														to take effect.
													</p>
													<p>Documentation link coming soon.</p>
												</div>
											)}
										</NumberedSetupSection>

										<NumberedSetupSection
											number={2}
											title='Connect your context files repository'
											ownership='Done by any context admin, once for everyone.'
											isDone={repositoryReady}
											completedContent={
												<ConnectedRepositorySummary
													repositoryName={status?.repo?.repoFullName}
													providerLabel={
														connectedRepositoryProvider
															? PROVIDER_CONFIGS[connectedRepositoryProvider].label
															: undefined
													}
													disconnectBlockedReason={repositoryDisconnectBlockedReason}
													onDisconnect={() => {
														disconnectRepository.reset();
														setIsDisconnectingRepository(true);
													}}
												/>
											}
										>
											<p className='text-sm text-muted-foreground'>
												Connect the repository that stores context files for this project.
											</p>

											{!accountReady && usesSharedToken ? (
												<DisabledAction
													label='Connect repository'
													reason='Save the GitHub access token in step 1 first.'
												/>
											) : !accountReady ? (
												<div className='flex flex-col items-start gap-2'>
													<p className='text-sm text-muted-foreground'>
														Connect the {provider.label} account that has access to the
														context files repository. nao uses this account to find and
														connect that repository.
													</p>
													{instanceReady ? (
														<Button size='sm' variant='secondary' asChild>
															<a href={provider.connectHref}>
																<ProviderIcon className='size-3.5' />
																Connect {provider.label} account
															</a>
														</Button>
													) : (
														<DisabledAction
															label={`Connect ${provider.label} account`}
															reason={`The nao admin must set the ${provider.label} server keys and redeploy or restart nao first.`}
															icon={provider.icon}
														/>
													)}
												</div>
											) : (
												<div className='flex min-w-0 flex-col gap-6'>
													{!usesSharedToken && (
														<div className='space-y-2'>
															<ProviderConnectionCard
																providerLabel={provider.label}
																icon={provider.icon}
																connectHref={provider.connectHref}
																description='This account is used to find repositories.'
																connected
																username={provider.account?.username}
																avatarUrl={provider.account?.avatarUrl}
																onDisconnect={provider.disconnect}
																disconnectPending={provider.disconnectPending}
															/>
															{provider.disconnectError && (
																<ErrorMessage
																	message={provider.disconnectError.message}
																/>
															)}
														</div>
													)}
													{canConnectRepository ? (
														<div className='flex min-w-0 flex-col gap-2'>
															{usesSharedToken ? (
																<GithubRepoList
																	useSharedToken
																	selected={selectedRepository}
																	onSelect={toggleSelectedRepository}
																/>
															) : (
																<RepositoryList
																	selected={selectedRepository}
																	onSelect={toggleSelectedRepository}
																/>
															)}
															<Button
																size='sm'
																disabled={!selectedRepository}
																onClick={() => {
																	connectRepository.reset();
																	setIsConfirmingRepository(true);
																}}
															>
																Review connection
															</Button>
															{!selectedRepository && (
																<p className='text-xs text-muted-foreground'>
																	Choose a repository to continue.
																</p>
															)}
														</div>
													) : (
														<DisabledAction
															label='Connect repository'
															reason={getRepositoryConnectBlockedReason(
																instanceReady,
																accountReady,
																provider.label,
															)}
														/>
													)}
												</div>
											)}

											{status?.gitUnavailableMessage &&
												status.gitUnavailableReason !== 'github-unavailable' &&
												status.gitUnavailableReason !== 'no-token' &&
												status.gitUnavailableReason !== 'no-repo' && (
													<p className='text-xs text-muted-foreground'>
														{status.gitUnavailableMessage}
													</p>
												)}
										</NumberedSetupSection>

										{!usesSharedToken && (
											<NumberedSetupSection
												number={3}
												title={`Connect your personal ${provider.label} account`}
												ownership='Done by every context admin, for themselves.'
												isDone={accountReady}
												completedContent={
													repositoryReady ? (
														<div className='space-y-2'>
															<ConnectedProviderAccount
																username={provider.account?.username}
																avatarUrl={provider.account?.avatarUrl}
																onDisconnect={provider.disconnect}
																disconnectPending={provider.disconnectPending}
															/>
															{provider.disconnectError && (
																<ErrorMessage
																	message={provider.disconnectError.message}
																/>
															)}
														</div>
													) : undefined
												}
											>
												{repositoryReady ? (
													<>
														<p className='text-sm text-muted-foreground'>
															Connect your own {provider.label} account because{' '}
															{provider.reviewRequestNamePlural} are opened as you. Your
															connection does not connect anyone else.
														</p>
														<ProviderConnectionCard
															providerLabel={provider.label}
															icon={provider.icon}
															connectHref={provider.connectHref}
															description={`This account is used to open ${provider.reviewRequestNamePlural} as you.`}
															connected={false}
															onDisconnect={provider.disconnect}
															disconnectPending={provider.disconnectPending}
															connectDisabledReason={
																instanceReady
																	? undefined
																	: `The nao admin must set the ${provider.label} server keys and redeploy or restart nao first.`
															}
														/>
													</>
												) : (
													<p className='text-sm text-muted-foreground'>
														Connect the context files repository in step 2 before each
														person can connect their own account.
													</p>
												)}
											</NumberedSetupSection>
										)}
									</div>
								)}
							</>
						)}
					</SettingsCard>
					{status?.liveContextUpdate.enabled && (
						<LiveContextUpdateSettings
							status={status.liveContextUpdate}
							repository={status.liveContextRepository}
							isAdmin={isAdmin}
						/>
					)}

					<AlertDialog
						open={providerSwitchRequest !== null}
						onOpenChange={(open) => {
							if (!open && !isSwitchingProvider) {
								setProviderSwitchRequest(null);
							}
						}}
					>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									Switch to{' '}
									{providerSwitchRequest
										? PROVIDER_CONFIGS[providerSwitchRequest.targetProvider].label
										: 'another provider'}
									?
								</AlertDialogTitle>
								<AlertDialogDescription>
									{providerSwitchRequest
										? getProviderSwitchDescription(providerSwitchRequest)
										: 'This will disconnect the current Git setup.'}
								</AlertDialogDescription>
							</AlertDialogHeader>
							{providerSwitchError && <ErrorMessage message={providerSwitchError.message} />}
							<AlertDialogFooter>
								<AlertDialogCancel disabled={isSwitchingProvider}>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant='destructive'
									isLoading={isSwitchingProvider}
									disabled={!providerSwitchRequest || isSwitchingProvider}
									onClick={(event) => {
										event.preventDefault();
										void handleConfirmProviderSwitch();
									}}
								>
									Switch provider
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>

					<AlertDialog
						open={isConfirmingRepository}
						onOpenChange={(open) => {
							if (!connectRepository.isPending) {
								setIsConfirmingRepository(open);
							}
						}}
					>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Connect {selectedRepository}?</AlertDialogTitle>
								<AlertDialogDescription>
									Connecting this repository will not overwrite or replace files in the live project.
									Context edits will be made in the shared review workspace.
								</AlertDialogDescription>
							</AlertDialogHeader>
							{connectRepository.error && <ErrorMessage message={connectRepository.error.message} />}
							<AlertDialogFooter>
								<AlertDialogCancel disabled={connectRepository.isPending}>Cancel</AlertDialogCancel>
								<AlertDialogAction
									isLoading={connectRepository.isPending}
									disabled={!selectedRepository || connectRepository.isPending}
									onClick={(event) => {
										event.preventDefault();
										if (selectedRepository) {
											connectRepository.mutate({
												provider: selectedProvider,
												repoFullName: selectedRepository,
											});
										}
									}}
								>
									Connect repository
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>

					<AlertDialog
						open={isDisconnectingRepository}
						onOpenChange={(open) => {
							if (!disconnectRepository.isPending) {
								setIsDisconnectingRepository(open);
							}
						}}
					>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Disconnect {status?.repo?.repoFullName}?</AlertDialogTitle>
								<AlertDialogDescription>
									This removes the context repository connection from this project. It does not delete
									the repository or its files.
								</AlertDialogDescription>
							</AlertDialogHeader>
							{disconnectRepository.error && (
								<ErrorMessage message={disconnectRepository.error.message} />
							)}
							<AlertDialogFooter>
								<AlertDialogCancel disabled={disconnectRepository.isPending}>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant='destructive'
									isLoading={disconnectRepository.isPending}
									disabled={disconnectRepository.isPending}
									onClick={(event) => {
										event.preventDefault();
										disconnectRepository.mutate();
									}}
								>
									Disconnect repository
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function ConnectedRepositorySummary({
	repositoryName,
	providerLabel,
	disconnectBlockedReason,
	onDisconnect,
}: {
	repositoryName: string | undefined;
	providerLabel: string | undefined;
	disconnectBlockedReason: string | null;
	onDisconnect: () => void;
}) {
	return (
		<div className='flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1'>
			<p className='truncate text-sm text-foreground'>
				{providerLabel && <span className='mr-2 text-muted-foreground'>{providerLabel}</span>}
				<span className='font-mono'>{repositoryName}</span>
			</p>
			<Button size='sm' variant='secondary' disabled={disconnectBlockedReason !== null} onClick={onDisconnect}>
				Disconnect
			</Button>
			{disconnectBlockedReason && <p className='text-xs text-muted-foreground'>{disconnectBlockedReason}</p>}
		</div>
	);
}

function ProviderSelector({
	selectedProvider,
	switchBlockedReason,
	onSelect,
}: {
	selectedProvider: GitProvider;
	switchBlockedReason: string | null;
	onSelect: (provider: GitProvider) => void;
}) {
	return (
		<div className='space-y-1 pl-9'>
			<div className='flex items-center gap-2' aria-label='Git provider'>
				{(Object.keys(PROVIDER_CONFIGS) as GitProvider[]).map((providerId) => {
					const provider = PROVIDER_CONFIGS[providerId];
					const Icon = provider.icon;
					const isSelected = providerId === selectedProvider;
					return (
						<Button
							key={providerId}
							type='button'
							size='sm'
							variant={isSelected ? 'secondary' : 'outline'}
							aria-pressed={isSelected}
							disabled={!isSelected && switchBlockedReason !== null}
							onClick={() => {
								onSelect(providerId);
							}}
						>
							<Icon className='size-3.5' />
							{provider.label}
						</Button>
					);
				})}
			</div>
			{switchBlockedReason && <p className='text-xs text-muted-foreground'>{switchBlockedReason}</p>}
		</div>
	);
}

function GithubAccessMethodSelector({
	selectedMethod,
	switchBlockedReason,
	onSelect,
}: {
	selectedMethod: GithubAccessMethod;
	switchBlockedReason: string | null;
	onSelect: (method: GithubAccessMethod) => void;
}) {
	return (
		<div className='space-y-1 pl-9'>
			<div className='flex items-center gap-2' aria-label='GitHub access'>
				{GITHUB_ACCESS_METHODS.map((method) => {
					const isSelected = method.id === selectedMethod;
					return (
						<Button
							key={method.id}
							type='button'
							size='sm'
							variant={isSelected ? 'secondary' : 'outline'}
							aria-pressed={isSelected}
							disabled={!isSelected && switchBlockedReason !== null}
							onClick={() => {
								onSelect(method.id);
							}}
						>
							{method.label}
						</Button>
					);
				})}
			</div>
			<p className='text-xs text-muted-foreground'>
				{switchBlockedReason ??
					GITHUB_ACCESS_METHODS.find((method) => method.id === selectedMethod)?.description}
			</p>
		</div>
	);
}

function NumberedSetupSection({
	number,
	title,
	ownership,
	isDone,
	completedContent,
	persistentContent,
	children,
}: {
	number: number;
	title: string;
	ownership: string;
	isDone?: boolean;
	completedContent?: ReactNode;
	persistentContent?: ReactNode;
	children: ReactNode;
}) {
	const headingId = `git-setup-section-${number}`;
	return (
		<section aria-labelledby={headingId} className={isDone && !persistentContent ? undefined : 'space-y-5'}>
			<div className='flex flex-wrap items-start justify-between gap-4'>
				<div className='flex min-w-0 items-start gap-3'>
					<span
						aria-hidden='true'
						className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold'
					>
						{number}
					</span>
					<div className='space-y-0.5'>
						<h2 id={headingId} className='text-base font-semibold'>
							{title}
						</h2>
						{!isDone && <p className='text-xs text-muted-foreground'>{ownership}</p>}
					</div>
				</div>
				<div className='flex min-w-0 flex-wrap items-center justify-end gap-3'>
					{isDone !== undefined && (
						<Badge variant={isDone ? 'default' : 'outline'} className='shrink-0'>
							{isDone ? 'Done' : 'Not yet'}
						</Badge>
					)}
					{isDone && completedContent}
				</div>
			</div>
			{persistentContent}
			{!isDone && children && <div className='space-y-6 pl-9'>{children}</div>}
		</section>
	);
}

function DisabledAction({
	label,
	reason,
	icon: Icon,
}: {
	label: string;
	reason: string;
	icon?: ComponentType<{ className?: string }>;
}) {
	return (
		<div className='flex flex-col items-start gap-1'>
			<Button size='sm' variant='secondary' disabled>
				{Icon && <Icon className='size-3.5' />}
				{label}
			</Button>
			<p className='text-xs text-muted-foreground'>{reason}</p>
		</div>
	);
}

function getRepositoryConnectBlockedReason(
	instanceReady: boolean,
	accountReady: boolean,
	providerLabel: string,
): string {
	if (!instanceReady) {
		return `Set the ${providerLabel} server keys and redeploy or restart nao first.`;
	}
	if (!accountReady) {
		return `Connect the ${providerLabel} account that can access the repository first.`;
	}
	return 'Repository setup is unavailable.';
}

function getRepositoryDisconnectBlockedReason(isAdmin: boolean): string | null {
	if (!isAdmin) {
		return 'Only a project admin can disconnect the context repository.';
	}
	return null;
}

function getProviderSwitchDescription(request: ProviderSwitchRequest): string {
	const targetProviderLabel = PROVIDER_CONFIGS[request.targetProvider].label;
	const sourceProviderLabel = PROVIDER_CONFIGS[request.sourceProvider].label;
	const disconnectedItems = [
		request.repositoryName ? `the context repository "${request.repositoryName}"` : null,
		request.disconnectAccount ? `the connected ${sourceProviderLabel} account` : null,
	].filter((item): item is string => item !== null);
	const disconnected = disconnectedItems.length > 0 ? joinWithAnd(disconnectedItems) : 'the current Git setup';
	return `Switching to ${targetProviderLabel} will disconnect ${disconnected}.`;
}

async function invalidateRepositoryQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.readFile.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileDiff.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getLiveContextPullHistory.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getRepo.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.github.getProjectGitInfo.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.gitlab.getProjectGitInfo.queryKey() }),
	]);
}

async function invalidateProviderAccountQueries(queryClient: QueryClient, provider: GitProvider): Promise<void> {
	const accountQueryKey = provider === 'github' ? trpc.github.getStatus.queryKey() : trpc.gitlab.getStatus.queryKey();
	const repositoriesQueryKey =
		provider === 'github' ? trpc.github.listRepos.queryKey() : trpc.gitlab.listProjects.queryKey();
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: accountQueryKey }),
		queryClient.invalidateQueries({ queryKey: repositoriesQueryKey }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
	]);
}

function getDefaultGithubAccessMethod(sharedTokenConfigured: boolean, oauthAvailable: boolean): GithubAccessMethod {
	return sharedTokenConfigured || !oauthAvailable ? 'shared-token' : 'personal-accounts';
}

function getDefaultProvider(
	repositoryProvider: string | undefined,
	githubAvailable: boolean,
	gitlabAvailable: boolean,
): GitProvider {
	if (isGitProvider(repositoryProvider)) {
		return repositoryProvider;
	}
	if (githubAvailable !== gitlabAvailable) {
		return githubAvailable ? 'github' : 'gitlab';
	}
	return 'github';
}

function isGitProvider(provider: string | undefined): provider is GitProvider {
	return provider === 'github' || provider === 'gitlab';
}
