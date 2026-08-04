import { GitBranch } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';

interface DeploymentContextSource {
	repositoryUrl: string | null;
	branch: string | null;
	subpath: string | null;
	authMethod: 'token' | 'ssh-key' | 'public';
}

interface DeploymentManagedGitSettingsProps {
	contextSource: DeploymentContextSource | null;
	recommendedSetupVisible: boolean;
	onToggleRecommendedSetup: () => void;
}

const AUTH_METHOD_LABELS: Record<DeploymentContextSource['authMethod'], string> = {
	token: 'Access token',
	'ssh-key': 'SSH deploy key',
	public: 'Public repository',
};

export function DeploymentManagedGitSettings({
	contextSource,
	recommendedSetupVisible,
	onToggleRecommendedSetup,
}: DeploymentManagedGitSettingsProps) {
	const repositoryUrl = contextSource?.repositoryUrl ?? null;
	const secondaryFacts = contextSource ? getSecondaryFacts(contextSource) : [];

	return (
		<SettingsCard
			title='Deployment repository'
			icon={<GitBranch className='size-4' />}
			description='Your deployment currently loads context files from this repository.'
			action={
				repositoryUrl && isHttpUrl(repositoryUrl) ? (
					<Button size='sm' variant='secondary' asChild>
						<a href={repositoryUrl} target='_blank' rel='noreferrer'>
							Open repository
						</a>
					</Button>
				) : undefined
			}
			className='gap-6 p-6'
		>
			<div className='min-w-0'>
				<div className='truncate font-mono text-base font-medium text-foreground'>
					{repositoryUrl ? getRepositoryName(repositoryUrl) : 'Repository unavailable'}
				</div>
				{secondaryFacts.length > 0 && (
					<div className='mt-1 truncate text-sm text-muted-foreground'>{secondaryFacts.join(' · ')}</div>
				)}
				{contextSource?.authMethod === 'public' && (
					<p className='mt-2 text-xs text-muted-foreground'>
						Context files are read-only because no access token or SSH deploy key is configured.
					</p>
				)}
			</div>

			<div className='flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6'>
				<p className='max-w-2xl text-sm text-muted-foreground'>
					{contextSource?.authMethod === 'public'
						? 'Set up GitHub OAuth to enable editing with personal accounts.'
						: "Set up GitHub OAuth to open pull requests from each person's account instead of the deployment token owner's account."}
				</p>
				<Button
					size='sm'
					variant='secondary'
					aria-expanded={recommendedSetupVisible}
					aria-controls='recommended-github-setup'
					onClick={onToggleRecommendedSetup}
				>
					{recommendedSetupVisible ? 'Hide GitHub setup' : 'Set up GitHub OAuth'}
				</Button>
			</div>
		</SettingsCard>
	);
}

function getSecondaryFacts(contextSource: DeploymentContextSource): string[] {
	return [
		contextSource.branch ? `Branch ${contextSource.branch}` : null,
		AUTH_METHOD_LABELS[contextSource.authMethod],
		contextSource.subpath ? `Subpath ${contextSource.subpath}` : null,
	].filter((fact): fact is string => fact !== null);
}

function getRepositoryName(repositoryUrl: string): string {
	try {
		const pathname = new URL(repositoryUrl).pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
		const segments = pathname.split('/').filter(Boolean);
		return segments.length >= 2 ? segments.slice(-2).join('/') : segments[0] || repositoryUrl;
	} catch {
		const normalized = repositoryUrl.replace(/\/+$/, '').replace(/\.git$/i, '');
		const match = normalized.match(/(?:[:/])([^/:]+\/[^/]+)$/);
		return match?.[1] ?? repositoryUrl;
	}
}

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}
