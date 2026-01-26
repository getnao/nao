import { ToolCallProvider } from '../../contexts/tool-call.provider';
import { DefaultToolCall } from './default';

import { DisplayChartToolCall } from './display-chart';
import { ExecuteSqlToolCall } from './execute-sql';
import { GrepToolCall } from './grep';
import { ListToolCall } from './list';
import { ReadToolCall } from './read';
import { SearchToolCall } from './search';
import type { StaticToolName, UIToolPart } from 'backend/chat';
import { getToolName } from '@/lib/ai';

const toolComponents: Record<StaticToolName, React.ComponentType> = {
	display_chart: DisplayChartToolCall,
	execute_sql: ExecuteSqlToolCall,
	grep: GrepToolCall,
	list: ListToolCall,
	read: ReadToolCall,
	search: SearchToolCall,
};

export const ToolCall = ({ toolPart }: { toolPart: UIToolPart }) => {
	const toolName = getToolName(toolPart);
	const Component = toolComponents[toolName] ?? DefaultToolCall;
	return (
		<ToolCallProvider toolPart={toolPart}>
			<Component />
		</ToolCallProvider>
	);
};
