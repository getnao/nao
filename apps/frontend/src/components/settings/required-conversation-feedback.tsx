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
	const isPending = features.isPending || agentSettings.isPending || updateAgentSettings.isPending;

	return (
		<SettingsCard
			title='Conversation feedback'
			description='Collect a thumbs up or down rating on the latest answer in each conversation.'
			action={!isLicensed ? <UpgradeToEnterprise /> : undefined}
		>
			<LockedFieldset disabled={!isLicensed}>
				<SettingsControlRow
					id='require-conversation-feedback'
					label='Collect conversation feedback'
					description='Show persistent rating controls and prompt users when they leave an unrated chat.'
					control={
						<Switch
							id='require-conversation-feedback'
							checked={isRequired}
							onCheckedChange={(enabled) =>
								updateAgentSettings.mutate({ requireConversationFeedback: enabled })
							}
							disabled={!isAdmin || !isLicensed || isPending}
						/>
					}
				/>
			</LockedFieldset>
		</SettingsCard>
	);
}
