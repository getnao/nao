import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { SettingsCard } from '@/components/ui/settings-card';
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
		<SettingsCard title='Experimental'>
			<div className='space-y-4'>
				<p className='text-sm text-muted-foreground'>
					Enable experimental features that are still in development. These features may be unstable or change
					without notice.
				</p>

				<div className='flex items-center justify-between py-2'>
					<div className='space-y-0.5'>
						<label
							htmlFor='python-sandboxing'
							className='text-sm font-medium text-foreground cursor-pointer'
						>
							Python sandboxing
						</label>
						<p className='text-xs text-muted-foreground'>
							Allow the agent to execute Python code in a secure sandboxed environment.
							{!pythonAvailable && ' Not available on this platform.'}
						</p>
					</div>
					<Switch
						id='python-sandboxing'
						checked={pythonSandboxingEnabled}
						onCheckedChange={handlePythonSandboxingChange}
						disabled={!isAdmin || !pythonAvailable || updateAgentSettings.isPending}
					/>
				</div>
			</div>
		</SettingsCard>
	);
}
