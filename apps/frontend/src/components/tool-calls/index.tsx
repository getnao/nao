import { ToolCallProvider } from '../../contexts/tool-call.provider';
import { DefaultToolCall } from './default';
import { DisplayChartToolCall } from './display-chart';
import { ExecuteSqlToolCall } from './execute-sql';
import { GrepToolCall } from './grep';
import { ListToolCall } from './list';
import { ReadToolCall } from './read';
import { SearchToolCall } from './search';
import type { StaticToolName, UIToolPart } from '@nao/backend/chat';
import { getToolName } from '@/lib/ai';

const toolComponents: Partial<Record<StaticToolName, React.ComponentType>> = {
	display_chart: DisplayChartToolCall,
	execute_sql: ExecuteSqlToolCall,
	grep: GrepToolCall,
	list: ListToolCall,
	read: ReadToolCall,
	search: SearchToolCall,
};

export const ToolCall = ({ toolPart }: { toolPart: UIToolPart }) => {
	const Component = toolComponents[getToolName(toolPart) as keyof typeof toolComponents] ?? DefaultToolCall;
	return (
		<ToolCallProvider toolPart={toolPart}>
			<Component />
		</ToolCallProvider>
	);
};
