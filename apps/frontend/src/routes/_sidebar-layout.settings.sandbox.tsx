import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Box } from 'lucide-react';

import { SandboxSecrets } from '@/components/settings/sandbox-secrets';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { usePermissions } from '@/hooks/use-permissions';
import { requireNonViewer } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/sandbox')({
	beforeLoad: requireNonViewer,
	component: SandboxPage,
});

function SandboxPage() {
	const { isAdmin } = usePermissions();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const sandboxesEnabled = agentSettings.data?.experimental?.sandboxes ?? false;
	const showDisabledNotice = agentSettings.isSuccess && !sandboxesEnabled;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Sandbox</h1>
					<p className='text-sm text-muted-foreground'>
						Configure what the agent has access to when it runs code in an isolated sandbox. These settings
						are yours alone and apply to this project.
					</p>
				</div>
				<div className='flex flex-col gap-12'>
					{showDisabledNotice && <SandboxesDisabledNotice isAdmin={isAdmin} />}
					<SandboxSecrets />
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function SandboxesDisabledNotice({ isAdmin }: { isAdmin: boolean }) {
	return (
		<div className='flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30'>
			<div className='shrink-0 rounded-full p-2 bg-muted text-muted-foreground'>
				<Box className='size-4' />
			</div>
			<div className='flex flex-col gap-1 min-w-0'>
				<span className='font-semibold text-foreground'>Sandboxes are off for this project</span>
				<p className='text-sm text-muted-foreground'>
					Secrets are only used when the agent runs code in a sandbox.{' '}
					{isAdmin ? (
						<>
							Turn sandboxes on under{' '}
							<Link
								to='/settings/project/agent'
								search={{ tab: 'tools' }}
								className='underline underline-offset-2 hover:text-foreground'
							>
								Agent → Experimental
							</Link>
							.
						</>
					) : (
						'Ask an admin to turn sandboxes on under Agent → Experimental.'
					)}
				</p>
			</div>
		</div>
	);
}
