import { createContext, useContext, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { UIToolPart } from 'backend/chat';
import { getToolName, isToolSettled } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

interface SimpleToolCallContextValue {
	isHovering: boolean;
	isExpanded: boolean;
}

const SimpleToolCallContext = createContext<SimpleToolCallContextValue | null>(null);

export const useSimpleToolCallContext = () => {
	const context = useContext(SimpleToolCallContext);
	if (!context) {
		throw new Error('useSimpleToolCallContext must be used within SimpleToolCall');
	}
	return context;
};

interface Props {
	toolPart: UIToolPart;
	onClick?: () => void;
}

export const ToolCall = ({ toolPart, onClick }: Props) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const [isHovering, setIsHovering] = useState(false);
	const canExpand = !!toolPart.errorText || !!toolPart.output;
	const isClickable = onClick || canExpand;
	const isSettled = isToolSettled(toolPart);
	const toolName = getToolName(toolPart);

	const handleClick = () => {
		if (canExpand) {
			setIsExpanded(!isExpanded);
		} else if (onClick && !canExpand) {
			onClick();
		}
	};

	return (
		<SimpleToolCallContext.Provider value={{ isHovering, isExpanded }}>
			<div onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}>
				<span
					className={cn(
						'select-none flex items-center gap-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&_*]:overflow-hidden [&_*]:text-ellipsis [&_*]:whitespace-nowrap transition-opacity duration-150',
						isExpanded ? 'opacity-100' : 'opacity-50',
						isClickable && !isExpanded
							? 'cursor-pointer hover:opacity-75'
							: isClickable
								? 'cursor-pointer'
								: '',
					)}
					onClick={handleClick}
				>
					{isSettled ? (
						<ChevronRight size={12} className={cn(isExpanded ? 'rotate-90' : '')} />
					) : (
						<Spinner className='size-4 opacity-50' />
					)}
					<span className={cn(!isSettled ? 'text-shimmer' : '')}>{toolName}</span>
				</span>

				{isExpanded && canExpand && (
					<div className='pl-5 mt-1.5 bg-backgroundSecondary relative'>
						<div className='h-full border-l border-l-border absolute top-0 left-[6px]' />
						<div>
							{toolPart.errorText ? (
								<pre className='p-2 overflow-auto max-h-80 m-0 bg-red-950'>{toolPart.errorText}</pre>
							) : toolPart.output ? (
								<pre className='overflow-auto max-h-80 m-0'>
									{JSON.stringify(toolPart.output, null, 2)}
								</pre>
							) : null}
						</div>
					</div>
				)}
			</div>
		</SimpleToolCallContext.Provider>
	);
};
