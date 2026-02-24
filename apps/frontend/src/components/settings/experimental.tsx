import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
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
	const [compactionThresholdInput, setCompactionThresholdInput] = useState('');

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
	const compactionThresholdTokens = agentSettings.data?.experimental?.conversationCompactionThresholdTokens ?? 48_000;

	useEffect(() => {
		setCompactionThresholdInput(String(compactionThresholdTokens));
	}, [compactionThresholdTokens]);

	const handlePythonSandboxingChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			experimental: {
				pythonSandboxing: enabled,
			},
		});
	};

	const handleCompactionThresholdBlur = () => {
		const parsedValue = Number(compactionThresholdInput);
		if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
			setCompactionThresholdInput(String(compactionThresholdTokens));
			return;
		}

		if (parsedValue === compactionThresholdTokens) {
			return;
		}

		updateAgentSettings.mutate({
			experimental: {
				conversationCompactionThresholdTokens: parsedValue,
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

			<SettingsControlRow
				id='compaction-threshold'
				label='Compaction token threshold'
				description='Approximate threshold (chars/4) for triggering conversation compaction during agent loops.'
				control={
					<Input
						id='compaction-threshold'
						type='number'
						min={1}
						step={1}
						value={compactionThresholdInput}
						onChange={(e) => setCompactionThresholdInput(e.target.value)}
						onBlur={handleCompactionThresholdBlur}
						disabled={!isAdmin || updateAgentSettings.isPending}
						className='w-40'
					/>
				}
			/>
		</SettingsCard>
	);
}
