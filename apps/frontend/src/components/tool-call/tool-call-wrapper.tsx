import { useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { useToolCallContext } from './context';
import type { ReactNode } from 'react';
import { isToolSettled } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

interface ActionButton {
	id: string;
	label: ReactNode;
	isActive?: boolean;
	onClick: () => void;
}

interface ToolCallWrapperProps {
	title: ReactNode;
	badge?: ReactNode;
	children: ReactNode;
	actions?: ActionButton[];
	defaultExpanded?: boolean;
	bordered?: boolean;
}

export const ToolCallWrapper = ({
	title,
	badge,
	children,
	actions,
	defaultExpanded = false,
	bordered = false,
}: ToolCallWrapperProps) => {
	const { toolPart, isExpanded, setIsExpanded, isHovering } = useToolCallContext();
	const canExpand = !!toolPart.errorText || !!toolPart.output;
	const isSettled = isToolSettled(toolPart);
	const hasInitialized = useRef(false);

	const isBordered = bordered || !!actions;

	useEffect(() => {
		if (isBordered && !hasInitialized.current && canExpand && defaultExpanded) {
			setIsExpanded(true);
			hasInitialized.current = true;
		}
	}, [isBordered, canExpand, defaultExpanded, setIsExpanded]);

	const handleValueChange = (value: string) => {
		setIsExpanded(value === 'tool-content');
	};

	const hasError = !!toolPart.errorText;
	const showChevron = isSettled && (!hasError || isHovering);

	const statusIcon = (
		<div className={cn('size-3 flex items-center justify-center', isBordered && 'flex-shrink-0')}>
			{showChevron ? (
				<ChevronRight
					size={12}
					className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
				/>
			) : hasError ? (
				<div className='size-2 rounded-full bg-red-500' />
			) : (
				<Spinner className='size-3 opacity-50' />
			)}
		</div>
	);

	const accordionContent = (
		<Accordion
			type='single'
			collapsible
			value={isBordered ? (isExpanded ? 'tool-content' : '') : undefined}
			onValueChange={handleValueChange}
			disabled={!canExpand}
		>
			<AccordionItem value='tool-content' className={cn('border-b-0', !isBordered && 'px-3')}>
				{isBordered ? (
					<div
						className={cn(
							'flex items-center justify-between gap-2 px-3 py-2',
							canExpand && 'cursor-pointer',
						)}
						onClick={() => canExpand && setIsExpanded(!isExpanded)}
					>
						<AccordionTrigger
							className={cn(
								'flex-1 select-none flex items-center gap-2 py-0 overflow-hidden transition-opacity duration-150 hover:no-underline',
								isExpanded ? 'opacity-100' : 'opacity-70',
								canExpand && !isExpanded
									? 'cursor-pointer hover:opacity-90'
									: canExpand
										? 'cursor-pointer'
										: '',
							)}
						>
							{statusIcon}
							<span className={cn('flex-1 font-medium truncate min-w-0', !isSettled && 'text-shimmer')}>
								{title}
							</span>
							{badge && <span className='text-xs opacity-50 flex-shrink-0'>{badge}</span>}
						</AccordionTrigger>

						{actions && actions.length > 0 && (
							<div
								className={cn(
									'flex items-center gap-1 flex-shrink-0',
									isExpanded || isHovering ? 'opacity-100' : 'opacity-0',
								)}
							>
								{actions.map((action) => (
									<button
										key={action.id}
										type='button'
										onClick={(e) => {
											e.stopPropagation();
											if (!isExpanded) {
												setIsExpanded(true);
											}
											action.onClick();
										}}
										className={cn(
											'px-1 py-1 text-xs rounded transition-colors cursor-pointer',
											action.isActive ? 'bg-primary text-primary-foreground' : '',
										)}
									>
										{action.label}
									</button>
								))}
							</div>
						)}
					</div>
				) : (
					<AccordionTrigger
						className={cn(
							'select-none flex items-center gap-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&_*]:overflow-hidden [&_*]:text-ellipsis [&_*]:whitespace-nowrap transition-opacity duration-150 py-0 hover:no-underline [&>svg:last-child]:hidden',
							isExpanded ? 'opacity-100' : 'opacity-50',
							canExpand && !isExpanded
								? 'cursor-pointer hover:opacity-75'
								: canExpand
									? 'cursor-pointer'
									: '',
						)}
					>
						{statusIcon}
						<span className={cn(!isSettled && 'text-shimmer')}>{title}</span>
						{badge && <span className='text-xs opacity-50'>{badge}</span>}
					</AccordionTrigger>
				)}

				<AccordionContent className={cn('pb-0', !isBordered && 'pt-1.5')}>
					{isBordered ? (
						<div className='border-t border-border'>
							{toolPart.errorText ? (
								<pre className='p-3 overflow-auto max-h-80 m-0 text-red-400 whitespace-pre-wrap break-words'>
									{toolPart.errorText}
								</pre>
							) : (
								children
							)}
						</div>
					) : (
						<div className='pl-5 bg-backgroundSecondary relative'>
							<div className='h-full border-l border-l-border absolute top-0 left-[6px]' />
							<div>
								{toolPart.errorText ? (
									<pre className='p-2 overflow-auto max-h-80 m-0'>{toolPart.errorText}</pre>
								) : (
									children
								)}
							</div>
						</div>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);

	if (isBordered) {
		return (
			<div className='border border-border rounded-lg overflow-hidden bg-backgroundSecondary/30'>
				{accordionContent}
			</div>
		);
	}

	return accordionContent;
};
