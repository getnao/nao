import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface SettingsProjectMemoryProps {
	isAdmin: boolean;
}

export function SettingsProjectMemory({ isAdmin }: SettingsProjectMemoryProps) {
	const queryClient = useQueryClient();
	const projectMemorySettings = useQuery(trpc.project.getMemorySettings.queryOptions());

	const updateProjectMemory = useMutation(
		trpc.project.updateMemorySettings.mutationOptions({
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
			title='Memory'
			description='Memories enable nao to remember preferences and facts about team members.'
			divide
		>
			<SettingsControlRow
				id='project-memory'
				label='Enable memory'
				description='Allow the agent to maintain a personal memory with each project member.'
				control={
					<Switch
						id='project-memory'
						checked={projectMemoryEnabled}
						onCheckedChange={handleProjectToggle}
						disabled={!isAdmin || updateProjectMemory.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}
