import { memo, useEffect, useMemo, useState } from 'react';
import { pluralize } from '@nao/shared';
import { ToolCall } from './index';
import type { UIToolPart } from '@nao/backend/chat';
import type { GroupablePart } from '@/types/ai';
import { Expandable } from '@/components/ui/expandable';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { useChatView } from '@/contexts/chat-view';
import { isReasoningPart, isQueryToolPart } from '@/lib/ai';
import { getLatestToolActivityLabel } from '@/lib/tool-activity';
import { useThrottledValue } from '@/hooks/use-throttled-value';
import { MIN_TITLE_DISPLAY_MS } from '@/hooks/use-tool-group-summary-title';

interface Props {
	parts: GroupablePart[];
	isSettled: boolean;
}

/** A run of queries folded into one inline step while preserving each query card's own display. */
export const QueryGroup = memo(({ parts, isSettled }: Props) => {
	const isLoading = !isSettled;
	const hasError = parts.some(isFailedQueryItem);
	const { expandOnError } = useChatView();
	const shouldStayOpenOnError = expandOnError && hasError;
	const [isExpanded, setIsExpanded] = useState(isLoading || shouldStayOpenOnError);

	useEffect(() => {
		setIsExpanded(isLoading || shouldStayOpenOnError);
	}, [isLoading, shouldStayOpenOnError]);

	const queryParts = useMemo(() => {
		return parts.filter(isQueryToolPart);
	}, [parts]);
	const title = useQueryGroupTitle({ parts, queryParts, isLoading, isExpanded });
	const badge = useMemo(() => {
		return formatTotalRows(queryParts);
	}, [queryParts]);

	return (
		<Expandable
			title={title}
			badge={badge}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isLoading}
			variant='inline'
		>
			<div className='flex flex-col gap-2 px-3'>
				{parts.map((part, index) => {
					if (isReasoningPart(part)) {
						return (
							<AssistantReasoning key={index} text={part.text} isStreaming={part.state === 'streaming'} />
						);
					}
					return <ToolCall key={part.toolCallId} toolPart={part} />;
				})}
			</div>
		</Expandable>
	);
});

const useQueryGroupTitle = (opts: {
	parts: GroupablePart[];
	queryParts: UIToolPart[];
	isLoading: boolean;
	isExpanded: boolean;
}): string => {
	const { parts, queryParts, isLoading, isExpanded } = opts;

	const title = useMemo(() => {
		const activeLabel = isLoading && !isExpanded ? getLatestToolActivityLabel(parts) : null;
		const count = queryParts.length;
		const fullTitle = activeLabel ?? `${isLoading ? 'Running' : 'Ran'} ${count} ${pluralize('query', count)}`;
		const errorCount = queryParts.filter(hasErrorText).length;
		if (!errorCount) {
			return fullTitle;
		}
		return `${fullTitle} (${errorCount} ${pluralize('error', errorCount)})`;
	}, [parts, queryParts, isLoading, isExpanded]);

	return useThrottledValue(title, MIN_TITLE_DISPLAY_MS, isLoading);
};

const isFailedQueryItem = (part: GroupablePart): boolean => {
	return !isReasoningPart(part) && part.state === 'output-error';
};

const hasErrorText = (part: UIToolPart): boolean => {
	return !!part.errorText;
};

const formatTotalRows = (queryParts: UIToolPart[]): string | undefined => {
	let total = 0;
	let hasOutput = false;
	for (const part of queryParts) {
		const output = part.output as { row_count?: number } | undefined;
		if (typeof output?.row_count === 'number') {
			total += output.row_count;
			hasOutput = true;
		}
	}
	return hasOutput ? `${total.toLocaleString()} ${pluralize('row', total)}` : undefined;
};
