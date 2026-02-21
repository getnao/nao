import type { Granularity } from '@nao/backend/usage';
import type { LlmProvider } from '@nao/backend/llm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ChartView = 'messages' | 'tokens' | 'cost';

const granularityOptions: { value: Granularity; label: string }[] = [
	{ value: 'hour', label: 'Hour' },
	{ value: 'day', label: 'Day' },
	{ value: 'month', label: 'Month' },
];

const chartViewOptions: { value: ChartView; label: string }[] = [
	{ value: 'messages', label: 'Messages' },
	{ value: 'tokens', label: 'Tokens' },
	{ value: 'cost', label: 'Cost' },
];

const providerLabels: Record<LlmProvider, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google',
	mistral: 'Mistral',
	openrouter: 'OpenRouter',
};

export const dateFormats: Record<Granularity, string> = {
	hour: 'MMM d, HH:00',
	day: 'MMM d',
	month: 'MMM yyyy',
};

interface UsageFiltersProps {
	chartView: ChartView;
	onChartViewChange: (value: ChartView) => void;
	provider: LlmProvider | 'all';
	onProviderChange: (value: LlmProvider | 'all') => void;
	granularity: Granularity;
	onGranularityChange: (value: Granularity) => void;
	availableProviders: LlmProvider[] | undefined;
}

export function UsageFilters({
	chartView,
	onChartViewChange,
	provider,
	onProviderChange,
	granularity,
	onGranularityChange,
	availableProviders,
}: UsageFiltersProps) {
	return (
		<div className='flex gap-2'>
			<Select value={chartView} onValueChange={(v) => onChartViewChange(v as ChartView)}>
				<SelectTrigger className='w-32'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{chartViewOptions.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select value={provider} onValueChange={(v) => onProviderChange(v as LlmProvider | 'all')}>
				<SelectTrigger className='w-36'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value='all'>All providers</SelectItem>
					{availableProviders?.map((p) => (
						<SelectItem key={p} value={p}>
							{providerLabels[p]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select value={granularity} onValueChange={(v) => onGranularityChange(v as Granularity)}>
				<SelectTrigger className='w-32'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{granularityOptions.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
