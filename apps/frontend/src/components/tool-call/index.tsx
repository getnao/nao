import { DefaultToolCall } from './default';

import { ExecuteSqlToolCall } from './execute-sql';
import { ListToolCall } from './list';
import { ReadToolCall } from './read';
import { SearchToolCall } from './search';
import type { UIToolPart } from 'backend/chat';
import type { ToolCallProps } from './context';
import { getToolName } from '@/lib/ai';

const toolComponents: Record<string, React.ComponentType<ToolCallProps>> = {
	execute_sql: ExecuteSqlToolCall,
	list: ListToolCall,
	read: ReadToolCall,
	search: SearchToolCall,
};

export const ToolCall = ({ toolPart }: { toolPart: UIToolPart }) => {
	const toolName = getToolName(toolPart);
	const Component = toolComponents[toolName] ?? DefaultToolCall;
	return <Component toolPart={toolPart} />;
};

export { DefaultToolCall } from './default';
export { ExecuteSqlToolCall } from './execute-sql';
export { ListToolCall } from './list';
export { ReadToolCall } from './read';
export { SearchToolCall } from './search';
export { useToolCallContext, ToolCallProvider, type ToolCallProps } from './context';
