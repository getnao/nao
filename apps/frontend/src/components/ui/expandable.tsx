import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

/** 'plain' renders the same header row as 'bordered' (incl. trailing actions) but without border, background, or padding. */
type ExpandableVariant = 'inline' | 'bordered' | 'plain';

interface ExpandableProps {
	title: ReactNode;
	badge?: ReactNode;
	children: ReactNode;
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	disabled?: boolean;
	isLoading?: boolean;
	leadingIcon?: ReactNode;
	trailingContent?: ReactNode;
	variant?: ExpandableVariant;
	className?: string;
}

export const Expandable = ({
	title,
	badge,
	children,
	expanded,
	onExpandedChange,
	disabled = false,
	isLoading = false,
	leadingIcon,
	trailingContent,
	variant = 'inline',
	className,
}: ExpandableProps) => {
	const canExpand = !disabled;
	const isBordered = variant === 'bordered';
	const hasHeaderRow = variant !== 'inline';

	const handleValueChange = () => {
		if (canExpand) {
			onExpandedChange(!expanded);
		}
	};

	const icon = leadingIcon ?? (
		<ChevronRight
			size={12}
			className={cn('transition-transform duration-200', expanded && 'rotate-90')}
			strokeWidth={3.25}
		/>
	);

	return (
		<Accordion
			type='single'
			collapsible
			value={expanded ? 'expandable-content' : ''}
			onValueChange={handleValueChange}
			disabled={!canExpand}
			className={cn(
				isBordered && 'border border-border rounded-lg overflow-hidden bg-backgroundSecondary/30',
				className,
			)}
		>
			<AccordionItem value='expandable-content' className='border-b-0' style={{ padding: 0 }}>
				{hasHeaderRow ? (
					<div
						className={cn(
							'flex items-center justify-between gap-2',
							isBordered && 'py-2 px-3',
							canExpand && 'cursor-pointer',
						)}
						onClick={() => canExpand && onExpandedChange(!expanded)}
					>
						<AccordionTrigger
							className={cn(
								'flex-1 select-none flex items-baseline gap-2 py-0 overflow-hidden transition-opacity duration-150 hover:no-underline [&>svg:last-child]:hidden',
								canExpand ? 'cursor-pointer' : '',
							)}
						>
							<div className='size-3 flex items-center justify-center shrink-0 self-center'>{icon}</div>
							<span
								className={cn(
									'flex-1 truncate min-w-0',
									isBordered ? 'font-medium' : 'text-sm',
									isLoading && 'text-shimmer',
								)}
							>
								{title}
							</span>
							{badge && !expanded && <span className='text-xs opacity-30 ml-auto shrink-0'>{badge}</span>}
						</AccordionTrigger>
						{trailingContent}
					</div>
				) : (
					<AccordionTrigger
						className={cn(
							'select-none flex items-center gap-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap transition-colors duration-150 py-0 hover:no-underline [&>svg:last-child]:hidden opacity-100',
							canExpand ? 'cursor-pointer' : '',
						)}
					>
						<div className='size-3 flex items-center justify-center shrink-0'>{icon}</div>
						<span
							className={cn(
								'flex-1 text-sm text-foreground font-normal truncate min-w-0',
								isLoading && 'text-shimmer',
							)}
						>
							{title}
						</span>
						{badge && !expanded && <span className='text-xs opacity-50 shrink-0'>{badge}</span>}
					</AccordionTrigger>
				)}

				<AccordionContent className={cn('pb-0', !isBordered && 'pt-1.5')}>
					{isBordered ? (
						<div className='border-t border-border'>{children}</div>
					) : (
						<div className='pl-5 bg-backgroundSecondary relative'>
							<div className='h-full border-l border-l-border absolute top-0 left-[6px]' />
							<div>{children}</div>
						</div>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
};
