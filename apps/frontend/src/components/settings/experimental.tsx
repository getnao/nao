import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface SettingsExperimentalProps {
	isAdmin: boolean;
}

export function SettingsExperimental({ isAdmin }: SettingsExperimentalProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const codemodeEnabled = agentSettings.data?.experimental?.codemode ?? false;
	const sandboxAvailable = agentSettings.data?.capabilities?.sandbox ?? true;
	const dangerouslyWritePermEnabled = agentSettings.data?.sql?.dangerouslyWritePermEnabled ?? false;
	const sandboxesEnabled = agentSettings.data?.experimental?.sandboxes ?? false;

	const handleCodemodeChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			experimental: {
				codemode: enabled,
			},
		});
	};

	const handleDangerouslyWritePermChange = (enabled: boolean) => {
		updateAgentSettings.mutate({ sql: { dangerouslyWritePermEnabled: enabled } });
	};

	const handleSandboxesChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			experimental: {
				sandboxes: enabled,
			},
		});
	};

	return (
		<SettingsCard
			title='Experimental'
			description='Enable experimental features that are still in development. These features may be unstable or change without notice.'
			divide
		>
			<SettingsControlRow
				id='codemode'
				label='Code mode'
				description='Let the agent write JavaScript that runs in an isolated sandbox to combine several MCP tool calls in a single step, loop over results and filter them before they reach the conversation.'
				control={
					<Switch
						id='codemode'
						checked={codemodeEnabled}
						onCheckedChange={handleCodemodeChange}
						disabled={!isAdmin || updateAgentSettings.isPending}
					/>
				}
			/>
			<SettingsControlRow
				id='sandboxes'
				label='Sandboxes'
				description={
					<span>
						Allow the agent to use sandboxes to run code in a secure environment. Works with{' '}
						<a
							href='https://github.com/boxlite-ai/boxlite'
							target='_blank'
							rel='noopener noreferrer'
							className='text-primary hover:text-primary/80 underline font-medium'
						>
							Boxlite
						</a>
						.
						{!sandboxAvailable &&
							' The sandbox runtime is unavailable on this host. Install it with `nao chat --sandbox` on a supported host.'}
					</span>
				}
				control={
					<Switch
						id='sandboxes'
						checked={sandboxesEnabled}
						onCheckedChange={handleSandboxesChange}
						disabled={!isAdmin || !sandboxAvailable || updateAgentSettings.isPending}
					/>
				}
			/>
			<SettingsControlRow
				id='dangerously-write-perm'
				label='Dangerous write permissions'
				description='Allow the agent to execute INSERT, UPDATE, DELETE and DDL SQL queries. By default only SELECT queries are permitted.'
				control={
					<Switch
						id='dangerously-write-perm'
						checked={dangerouslyWritePermEnabled}
						onCheckedChange={handleDangerouslyWritePermChange}
						disabled={!isAdmin || updateAgentSettings.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}
