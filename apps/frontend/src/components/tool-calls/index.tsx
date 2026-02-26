import { memo } from 'react';
import { StoryToolCall } from './story';
import { DefaultToolCall } from './default';
import { DisplayChartToolCall } from './display-chart';
import { ExecutePythonToolCall } from './execute-python';
import { ExecuteSandboxedCodeToolCall } from './execute-sandboxed-code';
import { ExecuteSqlToolCall } from './execute-sql';
import { GrepToolCall } from './grep';
import { ListToolCall } from './list';
import { ReadToolCall } from './read';
import { SearchToolCall } from './search';
import { WebFetchToolCall } from './web-fetch';
import { WebSearchToolCall } from './web-search';
import type { StaticToolName, UIToolPart } from '@nao/backend/chat';
import { getToolName, isToolSettled } from '@/lib/ai';
import { ToolCallProvider } from '@/contexts/tool-call';
import { useAssistantMessage } from '@/contexts/assistant-message';

export type ToolCallComponentProps<TToolName extends StaticToolName | undefined = undefined> = {
	toolPart: UIToolPart<TToolName>;
};

const toolComponents: Partial<{
	[TToolName in StaticToolName]: React.ComponentType<ToolCallComponentProps<TToolName>>;
}> = {
	story: StoryToolCall,
	display_chart: DisplayChartToolCall,
	execute_python: ExecutePythonToolCall,
	execute_sandboxed_code: ExecuteSandboxedCodeToolCall,
	execute_sql: ExecuteSqlToolCall,
	grep: GrepToolCall,
	list: ListToolCall,
	read: ReadToolCall,
	search: SearchToolCall,
};

const dynamicToolComponents: Record<string, React.ComponentType<ToolCallComponentProps>> = {
	web_search: WebSearchToolCall,
	web_fetch: WebFetchToolCall,
	google_search: WebSearchToolCall,
};

export const ToolCall = memo(({ toolPart }: { toolPart: UIToolPart }) => {
	const { isSettled: isMessageSettled } = useAssistantMessage();
	if (toolPart.type === 'tool-suggest_follow_ups') {
		return null;
	}

	const toolName = getToolName(toolPart);
	const Component =
		(toolComponents[toolName as StaticToolName] as React.ComponentType<ToolCallComponentProps> | undefined) ??
		dynamicToolComponents[toolName];

	const Rendered = Component ? <Component toolPart={toolPart} /> : <DefaultToolCall toolPart={toolPart} />;

	return (
		<ToolCallProvider
			value={{
				toolPart,
				// Check if the assistant message itself is settled in case tool execution was interrupted and persisted as not settled (e.g. input streaming).
				isSettled: isMessageSettled || isToolSettled(toolPart),
			}}
		>
			{Rendered}
		</ToolCallProvider>
	);
});
