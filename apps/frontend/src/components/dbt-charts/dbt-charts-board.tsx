import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DbtChartsControls } from './dbt-charts-controls';
import { DbtChartsDiagnostics } from './dbt-charts-diagnostics';
import { DbtChartsSvg } from './dbt-charts-svg';
import type { DbtChartsVariables } from '@nao/shared/dbt-charts';
import { cn } from '@/lib/utils';
import { useDbtChartsRender } from '@/hooks/use-dbt-charts-render';
import { Skeleton } from '@/components/ui/skeleton';

interface DbtChartsBoardProps {
	yaml: string;
	/** Changing this key discards user-selected variables (e.g. when switching board or version). */
	resetKey?: string;
	databaseId?: string;
	isStreaming?: boolean;
	className?: string;
}

/** A dbt Charts board: its variable controls, diagnostics and the server-rendered SVG. */
export function DbtChartsBoard({ yaml, resetKey, databaseId, isStreaming = false, className }: DbtChartsBoardProps) {
	const [overrides, setOverrides] = useState<DbtChartsVariables>({});

	useEffect(() => {
		setOverrides({});
	}, [resetKey]);

	const render = useDbtChartsRender({ yaml, variables: overrides, databaseId, enabled: !isStreaming });

	const handleVariableChange = useCallback((name: string, value: unknown) => {
		setOverrides((current) => {
			const next = { ...current };
			if (value === undefined) {
				delete next[name];
			} else {
				next[name] = value;
			}
			return next;
		});
	}, []);
	const handleReset = useCallback(() => setOverrides({}), []);

	const result = render.data;
	const isFetching = render.isFetching || isStreaming;
	const errors = result ? [...(result.board_error ? [result.board_error] : []), ...result.chart_errors] : [];

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			{result && (
				<DbtChartsControls
					controls={result.controls}
					overrides={overrides}
					onChange={handleVariableChange}
					onReset={handleReset}
					disabled={isFetching}
				/>
			)}
			{render.error && !result && (
				<DbtChartsDiagnostics
					errors={[
						{
							code: 'ERR-RENDER',
							message: render.error.message,
							level: 'error',
							fix: null,
							hint: null,
							chart: null,
							query: null,
							path: null,
							line: null,
						},
					]}
					warnings={[]}
				/>
			)}
			{result && <DbtChartsDiagnostics errors={errors} warnings={result.warnings} />}
			<div className='relative'>
				{result?.svg ? (
					<DbtChartsSvg svg={result.svg} className={cn('transition-opacity', isFetching && 'opacity-60')} />
				) : (
					!render.error && <BoardSkeleton />
				)}
				{isFetching && result?.svg && (
					<div className='pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm'>
						<Loader2 className='size-3.5 animate-spin' />
						{isStreaming ? 'Writing board…' : 'Rendering…'}
					</div>
				)}
			</div>
		</div>
	);
}

function BoardSkeleton() {
	return (
		<div className='flex flex-col gap-3'>
			<div className='grid grid-cols-3 gap-3'>
				<Skeleton className='h-20' />
				<Skeleton className='h-20' />
				<Skeleton className='h-20' />
			</div>
			<Skeleton className='h-64' />
		</div>
	);
}
