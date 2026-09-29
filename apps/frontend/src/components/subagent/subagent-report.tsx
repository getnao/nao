import { Streamdown } from 'streamdown';
import { markdownPlugins } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export function SubagentReport({ report, className }: { report: string; className?: string }) {
	return (
		<div className={cn('text-sm', className)}>
			<Streamdown mode='static' plugins={markdownPlugins}>
				{report}
			</Streamdown>
		</div>
	);
}
