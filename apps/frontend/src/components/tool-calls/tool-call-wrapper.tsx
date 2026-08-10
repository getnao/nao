import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import type { ReactNode } from 'react';
import type { DataExportFormat } from '@/components/export-data-menu';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Expandable } from '@/components/ui/expandable';
import { useToolCallContext } from '@/contexts/tool-call';
import { useIsInToolGroup } from '@/contexts/tool-group';
import { ToolCallActionsProvider } from '@/contexts/tool-call-actions';
import { ExportDataMenu } from '@/components/export-data-menu';

interface ExportAction {
	columns: string[];
	data: Record<string, unknown>[];
	filename: string;
	onExport?: (format: DataExportFormat) => void;
}

interface BaseAction {
	id: string;
	label: ReactNode;
	title: string;
	isActive?: boolean;
	expandOnClick?: boolean;
}

interface ButtonAction extends BaseAction {
	onClick: () => void;
}

interface ExportActionButton extends BaseAction {
	export: ExportAction;
}

export type ActionButton = ButtonAction | ExportActionButton;

interface ToolCallWrapperProps {
	title: ReactNode;
	badge?: ReactNode;
	children?: ReactNode;
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
	const { toolPart, isSettled } = useToolCallContext();
	const isInToolGroup = useIsInToolGroup();
	const [isExpanded, setIsExpanded] = useState(false);
	const [isHovering, setIsHovering] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const canExpand = Boolean(children || toolPart.errorText || toolPart.output);
	const hasInitialized = useRef(false);

	const hasActions = !!actions;
	// Inside a tool group, bordered tools render without border/padding to avoid overflowing the group container.
	const isBordered = hasActions && !isInToolGroup;
	const variant = isBordered ? 'bordered' : hasActions ? 'plain' : 'inline';

	useEffect(() => {
		if (hasActions && !hasInitialized.current && canExpand && defaultExpanded) {
			setIsExpanded(true);
			hasInitialized.current = true;
		}
	}, [hasActions, canExpand, defaultExpanded, setIsExpanded]);

	const hasError = !!toolPart.errorText;
	const showChevron = isSettled && (!hasError || isHovering);

	const statusIcon = showChevron ? undefined : hasError ? (
		<div className='size-2 rounded-full bg-red-500' />
	) : (
		<Spinner className='size-3 opacity-50' />
	);

	const actionsContent =
		(isHovering || isExpanded || isMenuOpen) && actions && actions.length > 0 ? (
			<div className={cn('flex items-center gap-1 shrink-0 -my-1')}>
				{actions.map((action) => {
					if ('export' in action) {
						return (
							<span key={action.id} onClick={(e) => e.stopPropagation()}>
								<ExportDataMenu {...action.export}>
									<Button
										variant='ghost-muted'
										size='icon-xs'
										title={action.title}
										className='rounded-full hover:bg-accent/70'
									>
										{action.label}
									</Button>
								</ExportDataMenu>
							</span>
						);
					}

					return (
						<Button
							variant='ghost-muted'
							size='icon-xs'
							key={action.id}
							onClick={(e) => {
								e.stopPropagation();
								if (action.expandOnClick && !isExpanded) {
									setIsExpanded(true);
								}
								action.onClick();
							}}
							title={action.title}
							className={cn('rounded-full hover:bg-accent/70', action.isActive ? 'bg-accent/70' : '')}
						>
							{action.label}
						</Button>
					);
				})}
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
		<ToolCallActionsProvider value={{ setMenuOpen: setIsMenuOpen }}>
			<div
				onMouseEnter={() => setIsHovering(true)}
				onMouseLeave={() => setIsHovering(false)}
				className={cn(isBordered && '-mx-3')}
				data-replay-target-id={toolPart.toolCallId}
				{...(hasError && {
					'data-replay-nav': 'tool-error',
					'data-replay-bordered': isBordered ? 'true' : 'false',
				})}
			>
				<Expandable
					title={title}
					badge={badge}
					expanded={isExpanded}
					onExpandedChange={setIsExpanded}
					disabled={!canExpand}
					isLoading={!isSettled}
					leadingIcon={statusIcon}
					variant={variant}
					trailingContent={actionsContent}
				>
					{contentToShow}
				</Expandable>
			</div>
		</ToolCallActionsProvider>
	);
};
