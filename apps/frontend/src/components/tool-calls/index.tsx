import { DefaultToolCall } from './default';
import { DisplayChartToolCall } from './display-chart';
import { ExecutePythonToolCall } from './execute-python';
import { ExecuteSqlToolCall } from './execute-sql';
import { GrepToolCall } from './grep';
import { ListToolCall } from './list';
import { ReadToolCall } from './read';
import { SearchToolCall } from './search';
import type { StaticToolName, UIToolPart } from '@nao/backend/chat';
import { getToolName } from '@/lib/ai';
import { ToolCallProvider } from '@/contexts/tool-call';

export type ToolCallComponentProps<TToolName extends StaticToolName | undefined = undefined> = {
	toolPart: UIToolPart<TToolName>;
};

const toolComponents: Partial<{
	[TToolName in StaticToolName]: React.ComponentType<ToolCallComponentProps<TToolName>>;
}> = {
	display_chart: DisplayChartToolCall,
	execute_python: ExecutePythonToolCall,
	execute_sql: ExecuteSqlToolCall,
	grep: GrepToolCall,
	list: ListToolCall,
	read: ReadToolCall,
	search: SearchToolCall,
};

export const ToolCall = ({ toolPart }: { toolPart: UIToolPart }) => {
	const Component = toolComponents[getToolName(toolPart) as StaticToolName] as
		| React.ComponentType<ToolCallComponentProps>
		| undefined;

	if (!Component) {
		return <DefaultToolCall toolPart={toolPart} />;
	}

	return (
		<ToolCallProvider toolPart={toolPart}>
			<Component toolPart={toolPart} />
		</ToolCallProvider>
	);
};
