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

	const pythonSandboxingEnabled = agentSettings.data?.experimental?.pythonSandboxing ?? false;
	const pythonAvailable = agentSettings.data?.capabilities?.pythonSandbox ?? true;

	const handlePythonSandboxingChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			experimental: {
				pythonSandboxing: enabled,
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
				id='python-sandboxing'
				label='Python sandboxing'
				description={`Allow the agent to execute Python code in a secure sandboxed environment.${
					!pythonAvailable ? ' Not available on this platform.' : ''
				}`}
				control={
					<Switch
						id='python-sandboxing'
						checked={pythonSandboxingEnabled}
						onCheckedChange={handlePythonSandboxingChange}
						disabled={!isAdmin || !pythonAvailable || updateAgentSettings.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}
