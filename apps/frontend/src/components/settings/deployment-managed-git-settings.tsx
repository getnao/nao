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
			description={getDescription(contextSource?.authMethod)}
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
					{getRecommendedSetupMessage(contextSource?.authMethod)}
				</p>
				<Button
					size='sm'
					variant='secondary'
					aria-expanded={recommendedSetupVisible}
					aria-controls={recommendedSetupVisible ? 'recommended-git-setup' : undefined}
					onClick={onToggleRecommendedSetup}
				>
					{recommendedSetupVisible ? 'Hide OAuth setup' : 'Set up Git OAuth'}
				</Button>
			</div>
		</SettingsCard>
	);
}

function getRecommendedSetupMessage(authMethod: DeploymentContextSource['authMethod'] | undefined): string {
	if (authMethod === 'public') {
		return 'Set up Git OAuth to enable editing with personal accounts.';
	}
	if (authMethod === 'ssh-key') {
		return "Review requests currently use the deployment's shared deploy key. Set up Git OAuth to use each person's own account.";
	}
	return "Review requests currently come from the deployment token owner's account. Set up Git OAuth to use each person's own account.";
}

function getDescription(authMethod: DeploymentContextSource['authMethod'] | undefined): string {
	if (authMethod === 'public') {
		return 'File Explorer reads context files from this public repository. Add Git OAuth to enable editing and review requests.';
	}
	return "File Explorer commits and review requests use this repository with the deployment's shared credential.";
}

function getSecondaryFacts(contextSource: DeploymentContextSource): string[] {
	return [
		contextSource.branch ? `Branch ${contextSource.branch}` : null,
		AUTH_METHOD_LABELS[contextSource.authMethod],
		contextSource.subpath ? `Subpath ${contextSource.subpath}` : null,
	].filter((fact): fact is string => fact !== null);
}

function getRepositoryName(repositoryUrl: string): string {
	if (!isHttpUrl(repositoryUrl)) {
		return repositoryUrl;
	}
	try {
		const pathname = new URL(repositoryUrl).pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
		const segments = pathname.split('/').filter(Boolean);
		return segments.join('/') || repositoryUrl;
	} catch {
		return repositoryUrl;
	}
}

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}
