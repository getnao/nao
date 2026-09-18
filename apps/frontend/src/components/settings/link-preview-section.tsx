import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LINK_PREVIEW_SETTINGS } from '@nao/shared/types';

import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface LinkPreviewSectionProps {
	isAdmin: boolean;
}

export function LinkPreviewSection({ isAdmin }: LinkPreviewSectionProps) {
	const queryClient = useQueryClient();
	const displaySettings = useQuery(trpc.project.getDisplaySettings.queryOptions());

	const updateDisplaySettings = useMutation(
		trpc.project.updateDisplaySettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getDisplaySettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const showSharedTitles =
		displaySettings.data?.linkPreviews?.showSharedTitles ?? DEFAULT_LINK_PREVIEW_SETTINGS.showSharedTitles;

	const handleShowSharedTitlesChange = (enabled: boolean) => {
		updateDisplaySettings.mutate({ linkPreviews: { showSharedTitles: enabled } });
	};

	return (
		<SettingsCard
			title='Link previews'
			description='Control what Slack, Teams and other chat tools show when someone pastes a nao link.'
		>
			<SettingsControlRow
				id='link-preview-shared-titles'
				label='Show titles of shared stories and conversations'
				description='Previews are generated without signing in, so anyone holding the link can read the title. Only applies to links shared with the whole project; restricted shares always stay generic.'
				control={
					<Switch
						id='link-preview-shared-titles'
						checked={showSharedTitles}
						onCheckedChange={handleShowSharedTitlesChange}
						disabled={!isAdmin || displaySettings.isLoading || updateDisplaySettings.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}
