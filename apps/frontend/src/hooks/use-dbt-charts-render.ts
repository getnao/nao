import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DbtChartsRender, DbtChartsVariables } from '@nao/shared/dbt-charts';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpcClient } from '@/main';

const RENDER_DEBOUNCE_MS = 400;

interface UseDbtChartsRenderParams {
	yaml: string;
	variables: DbtChartsVariables;
	databaseId?: string;
	enabled?: boolean;
}

/** Renders a board through the backend; the YAML is debounced so streaming or typing does not flood the warehouse. */
export function useDbtChartsRender({ yaml, variables, databaseId, enabled = true }: UseDbtChartsRenderParams) {
	const debouncedYaml = useDebouncedValue(yaml, RENDER_DEBOUNCE_MS);

	return useQuery<DbtChartsRender>({
		queryKey: ['dbtCharts', 'render', debouncedYaml, variables, databaseId ?? null],
		queryFn: () => trpcClient.dbtCharts.render.mutate({ yaml: debouncedYaml, variables, databaseId }),
		enabled: enabled && debouncedYaml.trim().length > 0,
		placeholderData: keepPreviousData,
		staleTime: 5 * 60 * 1000,
		retry: false,
	});
}
