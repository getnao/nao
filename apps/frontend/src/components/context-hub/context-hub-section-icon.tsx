import { FileText, ScrollText, Sigma, Sparkles, Table2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ContextHubSection } from '@/lib/context-hub';
import { cn } from '@/lib/utils';

export interface ContextHubSectionStyle {
	icon: LucideIcon;
	/** The icon colour, then its tile background, like Notion's coloured page icons. */
	iconClassName: string;
	tileClassName: string;
}

export const CONTEXT_HUB_SECTION_STYLES: Record<ContextHubSection, ContextHubSectionStyle> = {
	tables: {
		icon: Table2,
		iconClassName: 'text-blue-600 dark:text-blue-400',
		tileClassName: 'bg-blue-500/12 dark:bg-blue-400/15',
	},
	rules: {
		icon: ScrollText,
		iconClassName: 'text-orange-600 dark:text-orange-400',
		tileClassName: 'bg-orange-500/12 dark:bg-orange-400/15',
	},
	docs: {
		icon: FileText,
		iconClassName: 'text-amber-600 dark:text-amber-400',
		tileClassName: 'bg-amber-500/12 dark:bg-amber-400/15',
	},
	metrics: {
		icon: Sigma,
		iconClassName: 'text-emerald-600 dark:text-emerald-400',
		tileClassName: 'bg-emerald-500/12 dark:bg-emerald-400/15',
	},
	skills: {
		icon: Sparkles,
		iconClassName: 'text-violet-600 dark:text-violet-400',
		tileClassName: 'bg-violet-500/12 dark:bg-violet-400/15',
	},
};

/** The coloured tile of a Context Hub section, as its heading in the sidebar and its files elsewhere show it. */
export function ContextHubSectionIcon({ section, className }: { section: ContextHubSection; className?: string }) {
	const { icon: Icon, iconClassName, tileClassName } = CONTEXT_HUB_SECTION_STYLES[section];

	return (
		<span
			className={cn('flex size-5 shrink-0 items-center justify-center rounded-[5px]', tileClassName, className)}
		>
			<Icon className={cn('size-3.5', iconClassName)} />
		</span>
	);
}
