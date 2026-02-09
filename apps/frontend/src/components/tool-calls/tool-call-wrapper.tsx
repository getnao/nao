import { useEffect, useRef } from 'react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import type { ReactNode } from 'react';
import { isToolSettled } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Expandable } from '@/components/ui/expandable';

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
	overrideError?: boolean;
}

export const ToolCallWrapper = ({
	title,
	badge,
	children,
	actions,
	defaultExpanded = false,
	overrideError = false,
}: ToolCallWrapperProps) => {
	const { toolPart, isExpanded, setIsExpanded, isHovering } = useToolCallContext();
	const canExpand = !!toolPart.errorText || !!toolPart.output;
	const isSettled = isToolSettled(toolPart);
	const hasInitialized = useRef(false);

	const isBordered = !!actions;

	useEffect(() => {
		if (isBordered && !hasInitialized.current && canExpand && defaultExpanded) {
			setIsExpanded(true);
			hasInitialized.current = true;
		}
	}, [isBordered, canExpand, defaultExpanded, setIsExpanded]);

	const hasError = !!toolPart.errorText;
	const showChevron = isSettled && (!hasError || isHovering);

	const statusIcon = showChevron ? undefined : hasError ? (
		<div className='size-2 rounded-full bg-red-500' />
	) : (
		<Spinner className='size-3 opacity-50' />
	);

	const actionsContent =
		actions && actions.length > 0 ? (
			<div
				className={cn(
					'flex items-center gap-1 shrink-0',
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
		) : undefined;

	const errorContent = isBordered ? (
		<pre className='p-3 overflow-auto max-h-80 m-0 text-red-400 whitespace-pre-wrap wrap-break-word'>
			{toolPart.errorText}
		</pre>
	) : (
		<pre className='p-2 overflow-auto max-h-80 m-0'>{toolPart.errorText}</pre>
	);

	const contentToShow = toolPart.errorText && !overrideError ? errorContent : children;

	return (
		<Expandable
			title={title}
			badge={badge}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			disabled={!canExpand}
			isLoading={!isSettled}
			leadingIcon={statusIcon}
			variant={isBordered ? 'bordered' : 'inline'}
			trailingContent={actionsContent}
			className={cn(isBordered && '-mx-3')}
		>
			{contentToShow}
		</Expandable>
	);
};
