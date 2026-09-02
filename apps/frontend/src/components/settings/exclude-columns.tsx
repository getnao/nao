import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

interface SettingsExcludeColumnsProps {
	isAdmin: boolean;
}

export function SettingsExcludeColumns({ isAdmin }: SettingsExcludeColumnsProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const features = useLicenseFeatures();

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const isLicensed = features.data?.['exclude-columns'] === true;
	const enforceExcludedColumns = isLicensed ? (agentSettings.data?.sql?.enforceExcludedColumns ?? true) : false;

	const handleEnforcementChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			sql: { enforceExcludedColumns: enabled },
		});
	};

	return (
		<SettingsCard
			title='Exclude columns'
			description='Enabling this prevents the agent from querying columns listed in exclude_columns.'
		>
			<SettingsControlRow
				id='enforce-excluded-columns'
				label='Enforce excluded columns'
				description='Block SQL queries that access configured excluded columns.'
				control={
					<Switch
						id='enforce-excluded-columns'
						checked={enforceExcludedColumns}
						onCheckedChange={handleEnforcementChange}
						disabled={
							!isAdmin ||
							!isLicensed ||
							features.isPending ||
							agentSettings.isPending ||
							updateAgentSettings.isPending
						}
					/>
				}
			/>
		</SettingsCard>
	);
}
