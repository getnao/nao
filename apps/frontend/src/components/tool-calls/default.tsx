import { useState } from 'react';
import type { ToolCallComponentProps } from '.';
import { getToolName, isToolSettled } from '@/lib/ai';
import { Spinner } from '@/components/ui/spinner';
import { Expandable } from '@/components/ui/expandable';

export const DefaultToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const canExpand = !!toolPart.errorText || !!toolPart.output;
	const isSettled = isToolSettled(toolPart);
	const toolName = getToolName(toolPart);

	const statusIcon = isSettled ? undefined : <Spinner className='size-3 opacity-50' />;

	return (
		<Expandable
			title={toolName}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			disabled={!canExpand}
			isLoading={!isSettled}
			leadingIcon={statusIcon}
		>
			{toolPart.errorText ? (
				<pre className='p-2 overflow-auto max-h-80 m-0 bg-red-950'>{toolPart.errorText}</pre>
			) : toolPart.output ? (
				<pre className='overflow-auto max-h-80 m-0'>{JSON.stringify(toolPart.output, null, 2)}</pre>
			) : null}
		</Expandable>
	);
};
