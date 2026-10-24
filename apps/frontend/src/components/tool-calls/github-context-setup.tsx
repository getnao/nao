import { useQuery } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import GithubIcon from '@/components/icons/github-icon.svg';
import { GithubRepoList } from '@/components/settings/github-repo-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-fields';
import { trpc } from '@/main';

export interface GithubContextValues {
	repoFullName: string;
	branch: string;
}

interface GithubContextSetupProps {
	values: GithubContextValues;
	isStarting: boolean;
	onValuesChange: (values: GithubContextValues) => void;
}

export function GithubContextSetup({ values, isStarting, onValuesChange }: GithubContextSetupProps) {
	const [expanded, setExpanded] = useState(Boolean(values.repoFullName));
	const [isAuthorizing, setIsAuthorizing] = useState(false);
	const [popupBlocked, setPopupBlocked] = useState(false);
	const [authorizationError, setAuthorizationError] = useState<string | null>(null);
	const authWindow = useRef<Window | null>(null);
	const availability = useQuery(trpc.github.isAvailable.queryOptions());
	const status = useQuery({
		...trpc.github.getStatus.queryOptions(),
		refetchInterval: isAuthorizing ? 1000 : false,
	});
	const refetchStatus = status.refetch;
	const accountConnected = status.data?.connected === true;
	const repositoryConnected = accountConnected && values.repoFullName.length > 0;

	useEffect(() => {
		if (!isAuthorizing || !accountConnected) {
			return;
		}
		authWindow.current?.close();
		authWindow.current = null;
		setIsAuthorizing(false);
	}, [accountConnected, isAuthorizing]);

	useEffect(() => {
		if (!isAuthorizing) {
			return;
		}
		const finishAuthorization = (error?: string) => {
			authWindow.current?.close();
			authWindow.current = null;
			setIsAuthorizing(false);
			setAuthorizationError(error ?? null);
		};
		const interval = window.setInterval(() => {
			const popup = authWindow.current;
			if (popup?.closed) {
				authWindow.current = null;
				setIsAuthorizing(false);
				void refetchStatus();
				return;
			}
			try {
				if (popup && new URL(popup.location.href).searchParams.get('github') === 'error') {
					finishAuthorization('GitHub authorization failed. Please try again.');
				}
			} catch {
				return;
			}
		}, 500);
		const timeout = window.setTimeout(
			() => finishAuthorization('GitHub authorization timed out. Please try again.'),
			120_000,
		);
		return () => {
			window.clearInterval(interval);
			window.clearTimeout(timeout);
		};
	}, [isAuthorizing, refetchStatus]);

	useEffect(() => {
		return () => authWindow.current?.close();
	}, []);

	const connectGithub = () => {
		setPopupBlocked(false);
		setAuthorizationError(null);
		authWindow.current = window.open(
			'/api/github/connect?returnTo=/onboarding',
			'nao-github-connect',
			'popup,width=600,height=750',
		);
		if (!authWindow.current) {
			setPopupBlocked(true);
			return;
		}
		setIsAuthorizing(true);
	};

	return (
		<section className='space-y-4 rounded-xl border bg-muted/20 p-4'>
			<div className='flex items-center gap-3'>
				<div className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs'>
					<GithubIcon className='size-5' aria-hidden />
				</div>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<h3 className='text-sm font-medium'>GitHub</h3>
						<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
							Optional
						</Badge>
					</div>
					<p className='text-xs text-muted-foreground'>Sync a repository as business context.</p>
				</div>
				<Button type='button' variant='outline' size='sm' onClick={() => setExpanded((current) => !current)}>
					{expanded ? 'Hide' : repositoryConnected ? 'Edit' : 'Connect'}
				</Button>
			</div>

			{expanded && (
				<div className='space-y-4 border-t pt-4'>
					{availability.data === false ? (
						<p className='text-sm text-muted-foreground'>
							GitHub connections are not configured on this deployment.
						</p>
					) : accountConnected ? (
						<>
							<div className='flex items-center justify-between gap-3'>
								<div>
									<p className='text-sm font-medium'>Choose a repository</p>
									<p className='text-xs text-muted-foreground'>
										Connected as {status.data?.connected ? status.data.user.login : ''}
									</p>
								</div>
								{repositoryConnected && (
									<div className='flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400'>
										<CircleCheck className='size-4' />
										Connected
									</div>
								)}
							</div>
							<GithubRepoList
								selected={values.repoFullName || null}
								onSelect={(_, repo) =>
									onValuesChange({
										repoFullName: repo.full_name,
										branch: repo.default_branch,
									})
								}
								renderRepoMeta={(repo) => (
									<span className='mt-1 block text-[11px] text-muted-foreground'>
										{repo.default_branch}
									</span>
								)}
							/>
						</>
					) : (
						<div className='flex items-center justify-between gap-4'>
							<div>
								<p className='text-sm font-medium'>Connect your GitHub account</p>
								<p className='text-xs text-muted-foreground'>
									Choose from repositories you can access.
								</p>
							</div>
							<Button
								type='button'
								size='sm'
								className='rounded-full'
								onClick={connectGithub}
								disabled={availability.isLoading || isAuthorizing || isStarting}
								isLoading={isAuthorizing}
							>
								{isAuthorizing ? 'Waiting for GitHub…' : 'Connect GitHub'}
							</Button>
						</div>
					)}

					{popupBlocked && <FormError error='Allow popups for nao, then try connecting GitHub again.' />}
					{authorizationError && <FormError error={authorizationError} />}
					{status.error && <FormError error={status.error.message} />}
				</div>
			)}
		</section>
	);
}
