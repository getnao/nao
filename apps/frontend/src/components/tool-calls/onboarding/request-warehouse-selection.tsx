import { requestWarehouseSelection } from '@nao/shared/tools';
import { memo } from 'react';
import { ClarificationQuestion } from '../clarification';
import type { ToolCallComponentProps } from '..';

export const RequestWarehouseSelectionToolCall = memo(
	({ toolPart }: ToolCallComponentProps<'request_warehouse_selection'>) => (
		<ClarificationQuestion
			toolCallId={toolPart.toolCallId}
			isStreaming={false}
			question={requestWarehouseSelection.QUESTION}
			options={requestWarehouseSelection.OPTIONS}
		/>
	),
);
