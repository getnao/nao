import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_SEMANTIC_LAYER_MODE, SEMANTIC_LAYER_MODES } from '@nao/shared/types';
import type { SemanticLayerMode } from '@nao/shared/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

interface SettingsSemanticLayerProps {
	isAdmin: boolean;
}

const MODE_LABELS: Record<SemanticLayerMode, { label: string; description: string }> = {
	prioritized: {
		label: 'Semantics first',
		description:
			'Metric questions go through the semantic layer first; the agent falls back to SQL when it cannot answer.',
	},
	exclusive: {
		label: 'Semantics only',
		description: 'Every question goes through the semantic layer; the agent cannot run raw SQL at all.',
	},
	disabled: {
		label: "Don't use semantics",
		description: 'Definitions stay readable as context, but the agent cannot run semantic queries.',
	},
};

export function SettingsSemanticLayer({ isAdmin }: SettingsSemanticLayerProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.project.getAgentSettings.queryOptions().queryKey });
			},
		}),
	);

	const isConfigured = agentSettings.data?.capabilities?.semanticLayer ?? false;
	const mode = agentSettings.data?.semanticLayer?.mode ?? DEFAULT_SEMANTIC_LAYER_MODE;

	const handleModeChange = (nextMode: string) => {
		if (isSemanticLayerMode(nextMode)) {
			updateAgentSettings.mutate({ semanticLayer: { mode: nextMode } });
		}
	};

	return (
		<SettingsCard
			title='Semantic layer'
			description='Decide how the agent uses the dbt MetricFlow semantic layer declared in nao_config.yaml.'
		>
			<SettingsControlRow
				label='Mode'
				description={
					isConfigured ? (
						MODE_LABELS[mode].description
					) : (
						<>
							No semantic layer is declared in this project. Add a <code>semantic_layer</code> section to{' '}
							<code>nao_config.yaml</code> and run <code>nao sync</code> to enable it.
						</>
					)
				}
				control={
					<Select
						value={mode}
						onValueChange={handleModeChange}
						disabled={!isAdmin || !isConfigured || updateAgentSettings.isPending}
					>
						<SelectTrigger className='w-48'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SEMANTIC_LAYER_MODES.map((option) => (
								<SelectItem key={option} value={option}>
									{MODE_LABELS[option].label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>
		</SettingsCard>
	);
}

function isSemanticLayerMode(value: string): value is SemanticLayerMode {
	return (SEMANTIC_LAYER_MODES as readonly string[]).includes(value);
}
