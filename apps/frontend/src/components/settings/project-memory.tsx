import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

export function SettingsProjectMemory() {
	const queryClient = useQueryClient();
	const projectMemorySettings = useQuery(trpc.project.getMemorySettings.queryOptions());

	const updateProjectMemory = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getMemorySettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const projectMemoryEnabled = projectMemorySettings.data?.memoryEnabled ?? true;

	const handleProjectToggle = (enabled: boolean) => {
		updateProjectMemory.mutate({ memoryEnabled: enabled });
	};

	return (
		<SettingsCard
			title='Project memory'
			description='Controls memory for everyone in this project. When off, no member can use memory.'
			divide
		>
			<SettingsControlRow
				id='project-memory'
				label='Enable memory for this project'
				description='Allow members to use personal memory.'
				control={
					<Switch
						id='project-memory'
						checked={projectMemoryEnabled}
						onCheckedChange={handleProjectToggle}
						disabled={updateProjectMemory.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}
