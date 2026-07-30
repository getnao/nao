import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Github } from 'lucide-react';
import { useState } from 'react';

import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { GithubRepoList } from '@/components/settings/github-repo-list';
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
import { requireContextAdminOrAdmin } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/git')({
	beforeLoad: requireContextAdminOrAdmin,
	component: GitSettingsPage,
});

function GitSettingsPage() {
	const queryClient = useQueryClient();
	const { isAdmin } = usePermissions();
	const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
	const [isConfirmingRepository, setIsConfirmingRepository] = useState(false);
	const [isDisconnectingRepository, setIsDisconnectingRepository] = useState(false);

	const repositoryStatus = useQuery(trpc.contextExplorer.getRepositoryStatus.queryOptions());
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const instanceReady =
		repositoryStatus.data?.gitUnavailableReason !== 'github-unavailable' && githubAvailable.data === true;
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: instanceReady,
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
	const unlinkRepository = useMutation(
		trpc.github.unlinkProject.mutationOptions({
			onSuccess: async () => {
				await invalidateRepositoryQueries(queryClient);
				setIsDisconnectingRepository(false);
			},
		}),
	);
	const disconnectGithub = useMutation(
		trpc.github.disconnect.mutationOptions({
			onSuccess: async () => {
				await invalidateGithubAccountQueries(queryClient);
				setSelectedRepository(null);
			},
		}),
	);
	const handleDisconnectGithub = () => {
		disconnectGithub.reset();
		disconnectGithub.mutate();
	};

	const status = repositoryStatus.data;
	const connectedGithubUser = githubStatus.data?.connected ? githubStatus.data.user : null;
	const accountReady = connectedGithubUser !== null;
	const repositoryReady = status?.repo?.provider === 'github';
	const canConnectRepository =
		instanceReady && accountReady && !repositoryReady && status?.managedByContextSource !== true;
	const repositoryDisconnectBlockedReason = getRepositoryDisconnectBlockedReason(
		isAdmin,
		status?.managedByContextSource,
	);
	const isLoading =
		repositoryStatus.isLoading || githubAvailable.isLoading || (instanceReady && githubStatus.isLoading);
	const loadError = repositoryStatus.error ?? githubAvailable.error ?? githubStatus.error;

	return (
		<SettingsPageWrapper>
			<SettingsCard
				title='Git'
				titleSize='lg'
				description='Set up GitHub so context admins can edit context files and propose changes for review.'
				unstyled
				className='gap-10 px-4'
			>
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
								if (instanceReady) {
									void githubStatus.refetch();
								}
							}}
						>
							Retry
						</Button>
					</div>
				) : (
					<>
						<NumberedSetupSection
							number={1}
							title='GitHub server keys'
							ownership='Done by the admin who deploys nao, once for everyone.'
							isDone={instanceReady}
						>
							{!instanceReady && (
								<div className='space-y-2 text-sm text-muted-foreground'>
									<p>
										This needs{' '}
										<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground'>
											GITHUB_CLIENT_ID
										</code>{' '}
										and{' '}
										<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground'>
											GITHUB_CLIENT_SECRET
										</code>{' '}
										set on the server, from a GitHub OAuth App. If you run this instance, you can
										set them now. Otherwise ask your admin.
									</p>
									<p>
										After setting the server keys, redeploy or restart nao for them to take effect.
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
									disconnectBlockedReason={repositoryDisconnectBlockedReason}
									onDisconnect={() => {
										unlinkRepository.reset();
										setIsDisconnectingRepository(true);
									}}
								/>
							}
						>
							<p className='text-sm text-muted-foreground'>
								Connect the repository that stores context files for this project.
							</p>

							{!accountReady ? (
								<div className='flex flex-col items-start gap-2'>
									<p className='text-sm text-muted-foreground'>
										Connect the GitHub account that has access to the context files repository. nao
										uses this account to find and connect that repository.
									</p>
									{instanceReady ? (
										<Button size='sm' variant='secondary' asChild>
											<a href='/api/github/connect?returnTo=/settings/git'>
												<Github className='size-3.5' />
												Connect GitHub account
											</a>
										</Button>
									) : (
										<DisabledAction
											label='Connect GitHub account'
											reason='The nao admin must set the GitHub server keys and redeploy or restart nao first.'
										/>
									)}
								</div>
							) : (
								<div className='flex min-w-0 flex-col gap-6'>
									<div className='space-y-2'>
										<ProviderConnectionCard
											providerLabel='GitHub'
											icon={Github}
											connectHref='/api/github/connect?returnTo=/settings/git'
											description='This account is used to find repositories.'
											connected
											username={connectedGithubUser.login}
											avatarUrl={connectedGithubUser.avatarUrl}
											onDisconnect={handleDisconnectGithub}
											disconnectPending={disconnectGithub.isPending}
										/>
										{disconnectGithub.error && (
											<ErrorMessage message={disconnectGithub.error.message} />
										)}
									</div>
									{canConnectRepository ? (
										<div className='flex min-w-0 flex-col gap-2'>
											<GithubRepoList
												selected={selectedRepository}
												onSelect={(fullName) => {
													setSelectedRepository(
														fullName === selectedRepository ? null : fullName,
													);
												}}
											/>
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
												status?.managedByContextSource,
											)}
										/>
									)}
								</div>
							)}

							{status?.gitUnavailableMessage &&
								status.gitUnavailableReason !== 'github-unavailable' &&
								status.gitUnavailableReason !== 'no-token' &&
								status.gitUnavailableReason !== 'no-repo' && (
									<p className='text-xs text-muted-foreground'>{status.gitUnavailableMessage}</p>
								)}
						</NumberedSetupSection>

						<NumberedSetupSection
							number={3}
							title='Connect your personal GitHub account'
							ownership='Done by every context admin, for themselves.'
							isDone={accountReady}
							completedContent={
								repositoryReady ? (
									<div className='space-y-2'>
										<ConnectedProviderAccount
											username={connectedGithubUser?.login}
											avatarUrl={connectedGithubUser?.avatarUrl}
											onDisconnect={handleDisconnectGithub}
											disconnectPending={disconnectGithub.isPending}
										/>
										{disconnectGithub.error && (
											<ErrorMessage message={disconnectGithub.error.message} />
										)}
									</div>
								) : undefined
							}
						>
							{repositoryReady ? (
								<>
									<p className='text-sm text-muted-foreground'>
										Connect your own GitHub account because pull requests are opened as you. Your
										connection does not connect anyone else.
									</p>
									<ProviderConnectionCard
										providerLabel='GitHub'
										icon={Github}
										connectHref='/api/github/connect?returnTo=/settings/git'
										description='This account is used to open pull requests as you.'
										connected={false}
										onDisconnect={handleDisconnectGithub}
										disconnectPending={disconnectGithub.isPending}
										connectDisabledReason={
											instanceReady
												? undefined
												: 'The nao admin must set the GitHub server keys and redeploy or restart nao first.'
										}
									/>
								</>
							) : (
								<DisabledAction
									label='Connect GitHub account'
									reason='Connect your context files repository in step 2 first.'
								/>
							)}
						</NumberedSetupSection>
					</>
				)}
			</SettingsCard>

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
							Connecting this repository will not overwrite or replace files in the live project. Context
							edits will be made in the shared review workspace.
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
										provider: 'github',
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
					if (!unlinkRepository.isPending) {
						setIsDisconnectingRepository(open);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Disconnect {status?.repo?.repoFullName}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the context repository connection from this project. It does not delete the
							repository or its files.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{unlinkRepository.error && <ErrorMessage message={unlinkRepository.error.message} />}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={unlinkRepository.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							isLoading={unlinkRepository.isPending}
							disabled={unlinkRepository.isPending}
							onClick={(event) => {
								event.preventDefault();
								unlinkRepository.mutate();
							}}
						>
							Disconnect repository
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsPageWrapper>
	);
}

function ConnectedRepositorySummary({
	repositoryName,
	disconnectBlockedReason,
	onDisconnect,
}: {
	repositoryName: string | undefined;
	disconnectBlockedReason: string | null;
	onDisconnect: () => void;
}) {
	return (
		<div className='flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1'>
			<p className='truncate font-mono text-sm text-foreground'>{repositoryName}</p>
			<Button size='sm' variant='secondary' disabled={disconnectBlockedReason !== null} onClick={onDisconnect}>
				Disconnect
			</Button>
			{disconnectBlockedReason && <p className='text-xs text-muted-foreground'>{disconnectBlockedReason}</p>}
		</div>
	);
}

function NumberedSetupSection({
	number,
	title,
	ownership,
	isDone,
	completedContent,
	children,
}: {
	number: number;
	title: string;
	ownership: string;
	isDone?: boolean;
	completedContent?: ReactNode;
	children: ReactNode;
}) {
	const headingId = `git-setup-section-${number}`;
	return (
		<section aria-labelledby={headingId} className={isDone ? undefined : 'space-y-5'}>
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
			{!isDone && children && <div className='space-y-6 pl-9'>{children}</div>}
		</section>
	);
}

function DisabledAction({ label, reason }: { label: string; reason: string }) {
	return (
		<div className='flex flex-col items-start gap-1'>
			<Button size='sm' disabled>
				{label}
			</Button>
			<p className='text-xs text-muted-foreground'>{reason}</p>
		</div>
	);
}

function getRepositoryConnectBlockedReason(
	instanceReady: boolean,
	accountReady: boolean,
	managedByContextSource: boolean | undefined,
): string {
	if (!instanceReady) {
		return 'Set the GitHub server keys and redeploy or restart nao first.';
	}
	if (!accountReady) {
		return 'Connect the GitHub account that can access the repository first.';
	}
	if (managedByContextSource) {
		return 'This project repository is managed by the server deployment setting.';
	}
	return 'Repository setup is unavailable.';
}

function getRepositoryDisconnectBlockedReason(
	isAdmin: boolean,
	managedByContextSource: boolean | undefined,
): string | null {
	if (!isAdmin) {
		return 'Only a project admin can disconnect the context repository.';
	}
	if (managedByContextSource) {
		return 'This project repository is managed by the server deployment setting.';
	}
	return null;
}

async function invalidateRepositoryQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getRepo.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.github.getProjectGitInfo.queryKey() }),
	]);
}

async function invalidateGithubAccountQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.github.getStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.github.listRepos.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
	]);
}
