import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { trpc } from '@/main';

interface SettingsRequiredConversationFeedbackProps {
	isAdmin: boolean;
}

export function SettingsRequiredConversationFeedback({ isAdmin }: SettingsRequiredConversationFeedbackProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const features = useLicenseFeatures();
	const isCloud = useIsCloud();
	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				}),
		}),
	);

	if (isCloud) {
		return null;
	}

	const isLicensed = features.data?.['conversation-feedback'] === true;
	const isRequired = isLicensed && (agentSettings.data?.requireConversationFeedback ?? false);

	return (
		<SettingsCard
			title='Conversation feedback'
			description='Keep rating controls visible in every chat header so users are prompted to rate the latest answer.'
			action={!isLicensed ? <UpgradeToEnterprise /> : undefined}
		>
			<LockedFieldset disabled={!isLicensed}>
				<SettingsControlRow
					id='require-conversation-feedback'
					label='Require conversation feedback'
					description='Show persistent thumbs up and down controls without blocking users from leaving the chat.'
					control={
						<Switch
							id='require-conversation-feedback'
							checked={isRequired}
							onCheckedChange={(enabled) =>
								updateAgentSettings.mutate({ requireConversationFeedback: enabled })
							}
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
			</LockedFieldset>
		</SettingsCard>
	);
}
