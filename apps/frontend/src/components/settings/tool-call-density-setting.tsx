import type { ToolCallDensity } from '@nao/shared/types';

import { ToolCallDensitySlider } from '@/components/settings/tool-call-density-slider';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';

export function ToolCallDensitySetting({
	value,
	onValueChange,
	canChange,
	isLoading,
}: {
	value: ToolCallDensity;
	onValueChange: (value: ToolCallDensity) => void;
	canChange: boolean;
	isLoading: boolean;
}) {
	return (
		<SettingsControlRow
			label='Tool Call Density'
			description={
				isLoading
					? 'Loading setting...'
					: canChange
						? 'Adjust how much detail is shown for tool calls.'
						: 'Managed by your user group.'
			}
			control={
				<ToolCallDensitySlider value={value} onValueChange={onValueChange} disabled={!canChange || isLoading} />
			}
		/>
	);
}
