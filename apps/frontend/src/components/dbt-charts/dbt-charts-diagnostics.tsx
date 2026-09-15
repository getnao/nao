import { AlertTriangle } from 'lucide-react';
import { formatDbtChartsDiagnostic } from '@nao/shared/dbt-charts';
import type { DbtChartsDiagnostic } from '@nao/shared/dbt-charts';
import { FixInChatButton } from '@/components/fix-in-chat-button';
import { cn } from '@/lib/utils';

const MAX_VISIBLE = 5;

export function DbtChartsDiagnostics({
	errors,
	warnings,
	className,
}: {
	errors: DbtChartsDiagnostic[];
	warnings: DbtChartsDiagnostic[];
	className?: string;
}) {
	if (errors.length === 0 && warnings.length === 0) {
		return null;
	}
	const isError = errors.length > 0;
	const items = isError ? errors : warnings;
	const fixMessage = [
		isError ? "I'm seeing errors in the dbt Charts board:" : "I'm seeing warnings in the dbt Charts board:",
		...items.slice(0, 10).map((diagnostic) => `- [${diagnostic.code}] ${formatDbtChartsDiagnostic(diagnostic)}`),
		...(items.length > 10 ? [`- and ${items.length - 10} more...`] : []),
		'',
		'Please fix the board YAML.',
	].join('\n');

	return (
		<div
			className={cn(
				'flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs',
				isError
					? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
					: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
				className,
			)}
		>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-1.5 font-medium'>
					<AlertTriangle className='size-3.5 shrink-0' />
					<span>
						{items.length}{' '}
						{isError
							? items.length === 1
								? 'error'
								: 'errors'
							: items.length === 1
								? 'warning'
								: 'warnings'}
					</span>
				</div>
				<ul className='mt-1 flex flex-col gap-0.5'>
					{items.slice(0, MAX_VISIBLE).map((diagnostic, index) => (
						<li key={`${diagnostic.code}-${index}`} className='truncate'>
							<span className='font-mono opacity-70'>{diagnostic.code}</span>{' '}
							{formatDbtChartsDiagnostic(diagnostic)}
						</li>
					))}
					{items.length > MAX_VISIBLE && (
						<li className='opacity-70'>and {items.length - MAX_VISIBLE} more...</li>
					)}
				</ul>
			</div>
			<FixInChatButton message={fixMessage} className='shrink-0 gap-1.5' />
		</div>
	);
}
