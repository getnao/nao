import { cn } from '@/lib/utils';

export interface McpTool {
	name: string;
	description: string;
	condition?: string;
}

export interface McpToolGroup {
	title: string;
	availability: string;
	requiresMode?: boolean;
	tools: McpTool[];
}

export const SUB_AGENT_TOOLS: McpTool[] = [
	{ name: 'ask_nao', description: "Hands a question to nao's agent and returns its answer, charts and stories." },
	{ name: 'get_nao_answer', description: 'Polls an ask_nao run that is still going.' },
];

export const CONTEXT_LAYER_TOOLS: McpTool[] = [
	{ name: 'ls_nao_context', description: 'Lists the files of the project context.' },
	{ name: 'grep_nao_context', description: 'Searches the project context.' },
	{ name: 'read_nao_context', description: 'Reads a file of the project context.' },
	{
		name: 'execute_sql',
		description:
			"Runs a SQL query on a connected database, or only on nao's local database when the semantic layer is exclusive.",
	},
	{
		name: 'execute_semantic_query',
		description: 'Queries metrics and dimensions of the semantic layer.',
		condition: 'When the semantic layer is prioritized or exclusive',
	},
	{
		name: 'create_story',
		description: 'Creates a story from query results and charts.',
		condition: 'Story creation permission',
	},
	{ name: 'update_story', description: 'Edits an existing story.' },
];

export const SHARED_TOOL_GROUPS: McpToolGroup[] = [
	{
		title: 'Charts & stories',
		availability: 'With either mode on',
		requiresMode: true,
		tools: [
			{ name: 'display_chart', description: 'Renders an interactive chart from a query result.' },
			{ name: 'display_map', description: 'Renders a map from a query result.' },
			{ name: 'list_stories', description: 'Lists the stories of the project.' },
			{ name: 'get_story', description: 'Fetches a story with its latest content.' },
			{ name: 'archive_story', description: 'Archives a story, which can be restored from the UI.' },
			{ name: 'delete_story', description: 'Deletes a story and its versions for good.' },
		],
	},
	{
		title: 'Chat history & tests',
		availability: 'Admins and context admins',
		tools: [
			{ name: 'search_chats', description: 'Searches the chats of every project member.' },
			{ name: 'get_chat', description: 'Reads a chat as a transcript, with tool calls and feedback.' },
			{ name: 'list_tests', description: 'Lists the tests of the project.' },
			{ name: 'run_tests', description: 'Starts a test run.' },
			{ name: 'list_test_runs', description: 'Lists the latest test runs.' },
			{ name: 'get_test_run', description: 'Fetches a test run with each test result.' },
			{ name: 'cancel_test_run', description: 'Cancels a queued or running test run.' },
			{
				name: 'list_recommendations',
				description: 'Lists the context recommendations nao derived from usage.',
				condition: 'Context recommendations beta',
			},
			{
				name: 'get_recommendation',
				description: 'Fetches a recommendation with what is needed to apply it.',
				condition: 'Context recommendations beta',
			},
			{
				name: 'set_recommendation_status',
				description: 'Marks a recommendation as applied or dismissed.',
				condition: 'Context recommendations beta',
			},
		],
	},
	{
		title: 'Budgets',
		availability: 'Admins',
		tools: [
			{
				name: 'export_member_budgets',
				description: 'Exports the AI usage and budget of every member as CSV.',
				condition: 'Member budgets license',
			},
		],
	},
];

export function McpToolList({ tools, inactive = false }: { tools: McpTool[]; inactive?: boolean }) {
	return (
		<ul className={cn('flex flex-col gap-1.5 text-xs', inactive && 'opacity-50')}>
			{tools.map((tool) => (
				<li key={tool.name} className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
					<code className='text-[0.7rem] text-foreground bg-muted px-1 py-0.5 rounded'>{tool.name}</code>
					<span className='text-muted-foreground'>{tool.description}</span>
					{tool.condition && <span className='text-muted-foreground/70 italic'>· {tool.condition}</span>}
				</li>
			))}
		</ul>
	);
}

export function McpToolGroupSection({ group, inactive = false }: { group: McpToolGroup; inactive?: boolean }) {
	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-baseline justify-between gap-2'>
				<p className='text-sm font-medium text-foreground'>{group.title}</p>
				<span className='text-xs text-muted-foreground'>{group.availability}</span>
			</div>
			<McpToolList tools={group.tools} inactive={inactive} />
		</div>
	);
}
