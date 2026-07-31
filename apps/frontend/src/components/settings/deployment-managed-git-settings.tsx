interface DeploymentContextSource {
	repositoryUrl: string | null;
	branch: string | null;
	subpath: string | null;
	authMethod: 'token' | 'ssh-key' | 'public';
}

interface DeploymentManagedGitSettingsProps {
	contextSource: DeploymentContextSource | null;
}

const AUTH_METHOD_LABELS: Record<DeploymentContextSource['authMethod'], string> = {
	token: 'Deploy token',
	'ssh-key': 'SSH deploy key',
	public: 'Public repository',
};

export function DeploymentManagedGitSettings({ contextSource }: DeploymentManagedGitSettingsProps) {
	return (
		<section className='space-y-6'>
			<div className='space-y-1'>
				<h2 className='text-base font-semibold'>Context files are managed by your deployment</h2>
				<p className='text-sm text-muted-foreground'>
					Your deployment loads context files from a repository, so there is nothing to set up here.
				</p>
			</div>

			{contextSource && (
				<dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm'>
					{contextSource.repositoryUrl && (
						<ContextSourceRow label='Repository'>
							{isHttpUrl(contextSource.repositoryUrl) ? (
								<a
									href={contextSource.repositoryUrl}
									target='_blank'
									rel='noreferrer'
									className='break-all font-mono text-foreground underline-offset-4 hover:underline'
								>
									{contextSource.repositoryUrl}
								</a>
							) : (
								<span className='break-all font-mono text-foreground'>
									{contextSource.repositoryUrl}
								</span>
							)}
						</ContextSourceRow>
					)}
					{contextSource.branch && (
						<ContextSourceRow label='Branch'>
							<span className='font-mono text-foreground'>{contextSource.branch}</span>
						</ContextSourceRow>
					)}
					{contextSource.subpath && (
						<ContextSourceRow label='Subpath'>
							<span className='break-all font-mono text-foreground'>{contextSource.subpath}</span>
						</ContextSourceRow>
					)}
					<ContextSourceRow label='Authentication'>
						<span className='text-foreground'>{AUTH_METHOD_LABELS[contextSource.authMethod]}</span>
					</ContextSourceRow>
				</dl>
			)}

			<p className='text-sm text-muted-foreground'>
				Update context by pushing changes to this repository rather than editing it in nao.
			</p>
		</section>
	);
}

function ContextSourceRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<>
			<dt className='text-muted-foreground'>{label}</dt>
			<dd className='min-w-0'>{children}</dd>
		</>
	);
}

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}
