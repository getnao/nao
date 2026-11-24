import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

const SWITCH_ID = 'dangerously-write-perm';

export function SettingsSqlWritePermissions({ isAdmin }: { isAdmin: boolean }) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.project.getAgentSettings.queryOptions().queryKey });
			},
		}),
	);

	return (
		<SettingsCard
			title='Write permissions'
			description='Decide whether the agent may change the data of your warehouse.'
		>
			<SettingsToggleRow
				id={SWITCH_ID}
				label='Dangerous write permissions'
				description='Allow the agent to execute INSERT, UPDATE, DELETE and DDL SQL queries. By default only SELECT queries are permitted.'
				checked={agentSettings.data?.sql?.dangerouslyWritePermEnabled ?? false}
				onCheckedChange={(enabled) => {
					updateAgentSettings.mutate({ sql: { dangerouslyWritePermEnabled: enabled } });
				}}
				disabled={!isAdmin || updateAgentSettings.isPending}
			/>
		</SettingsCard>
	);
}
