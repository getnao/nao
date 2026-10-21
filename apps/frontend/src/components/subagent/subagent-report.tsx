import { Streamdown } from 'streamdown';
import { markdownPlugins } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { markdownLinkSafety } from '@/components/external-link-dialog';

export function SubagentReport({ report, className }: { report: string; className?: string }) {
	return (
		<div className={cn('text-sm', className)}>
			<Streamdown linkSafety={markdownLinkSafety} mode='static' plugins={markdownPlugins}>
				{report}
			</Streamdown>
		</div>
	);
}
