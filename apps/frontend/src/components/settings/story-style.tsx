import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_STORY_STYLE, STORY_STYLES } from '@nao/shared/dbt-charts';
import type { StoryStyle } from '@nao/shared/dbt-charts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

interface SettingsStoryStyleProps {
	isAdmin: boolean;
}

const STYLE_SELECT_ID = 'story-style';

const STYLE_LABELS: Record<StoryStyle, { label: string; description: string }> = {
	markdown: {
		label: 'nao markdown',
		description: 'The agent writes stories as nao markdown documents mixing text, charts and tables.',
	},
	dbt_charts: {
		label: 'dbt Charts',
		description:
			'The agent writes stories as dbt Charts YAML boards rendered server-side through your connections.',
	},
	both: {
		label: 'Both',
		description: 'The agent writes nao markdown by default and switches to a dbt Charts board when asked for one.',
	},
};

export function SettingsStoryStyle({ isAdmin }: SettingsStoryStyleProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.project.getAgentSettings.queryOptions().queryKey });
			},
		}),
	);

	const isDbtChartsAvailable = agentSettings.data?.capabilities?.dbtCharts ?? false;
	const style = agentSettings.data?.stories?.style ?? DEFAULT_STORY_STYLE;

	const handleStyleChange = (nextStyle: string) => {
		if (isStoryStyle(nextStyle)) {
			updateAgentSettings.mutate({ stories: { style: nextStyle } });
		}
	};

	return (
		<SettingsCard
			title='Stories'
			description='Choose the kind of stories the agent writes. Existing stories stay readable whatever the choice.'
		>
			<SettingsControlRow
				id={STYLE_SELECT_ID}
				label='Story format'
				description={
					isDbtChartsAvailable ? (
						STYLE_LABELS[style].description
					) : (
						<>
							dbt Charts is not installed on this instance. Install <code>nao-core[dbt-charts]</code> to
							let the agent write dbt Charts boards.
						</>
					)
				}
				control={
					<Select
						value={style}
						onValueChange={handleStyleChange}
						disabled={!isAdmin || !isDbtChartsAvailable || updateAgentSettings.isPending}
					>
						<SelectTrigger id={STYLE_SELECT_ID} className='w-48'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{STORY_STYLES.map((option) => (
								<SelectItem key={option} value={option}>
									{STYLE_LABELS[option].label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>
		</SettingsCard>
	);
}

function isStoryStyle(value: string): value is StoryStyle {
	return (STORY_STYLES as readonly string[]).includes(value);
}
