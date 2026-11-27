import { Badge } from '@/components/ui/badge';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn } from '@/lib/utils';

type McpModeRequirement = 'subAgent' | 'contextLayer' | 'anyMode';

interface McpTool {
	name: string;
	description: string;
	condition?: string;
}

interface McpToolGroup {
	title: string;
	availability: string;
	condition?: string;
	requires?: McpModeRequirement;
	tools: McpTool[];
}

interface McpModes {
	endpointEnabled: boolean;
	subAgentModeEnabled: boolean;
	contextLayerModeEnabled: boolean;
}

const ADMINS_AND_CONTEXT_ADMINS = 'Admins & context admins';

const MCP_TOOL_GROUPS: McpToolGroup[] = [
	{
		title: 'Sub-agent',
		availability: 'Sub-agent mode',
		requires: 'subAgent',
		tools: [
			{
				name: 'ask_nao',
				description: "Hands a question to nao's agent and returns its answer, charts and stories.",
			},
			{ name: 'get_nao_answer', description: 'Polls an ask_nao run that is still going.' },
		],
	},
	{
		title: 'Context layer',
		availability: 'Context-layer mode',
		requires: 'contextLayer',
		tools: [
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
				condition: 'Semantic layer',
			},
			{
				name: 'create_story',
				description: 'Creates a story from query results and charts.',
				condition: 'Story creation',
			},
			{ name: 'update_story', description: 'Edits an existing story.' },
		],
	},
	{
		title: 'Charts & stories',
		availability: 'Either mode',
		requires: 'anyMode',
		tools: [
			{ name: 'display_chart', description: 'Renders an interactive chart from a query result.' },
			{ name: 'display_map', description: 'Renders a map from a query result.' },
			{ name: 'list_stories', description: 'Lists the stories of the project.' },
			{ name: 'get_story', description: 'Fetches a story with its latest content.' },
			{ name: 'archive_story', description: 'Archives a story, which can be restored from the UI.' },
			{ name: 'delete_story', description: 'Deletes a story and its versions for good.' },
			{ name: 'list_story_folders', description: 'Lists the story folders the user can see.' },
			{ name: 'move_story', description: 'Moves a story to a folder, sharing it with whoever sees that folder.' },
		],
	},
	{
		title: 'Chat history',
		availability: ADMINS_AND_CONTEXT_ADMINS,
		tools: [
			{ name: 'search_chats', description: 'Searches the chats of every project member.' },
			{ name: 'get_chat', description: 'Reads a chat as a transcript, with tool calls and feedback.' },
		],
	},
	{
		title: 'Tests',
		availability: ADMINS_AND_CONTEXT_ADMINS,
		tools: [
			{ name: 'list_tests', description: 'Lists the tests of the project.' },
			{ name: 'run_tests', description: 'Starts a test run.' },
			{ name: 'list_test_runs', description: 'Lists the latest test runs.' },
			{ name: 'get_test_run', description: 'Fetches a test run with each test result.' },
			{ name: 'cancel_test_run', description: 'Cancels a queued or running test run.' },
		],
	},
	{
		title: 'Context recommendations',
		availability: ADMINS_AND_CONTEXT_ADMINS,
		condition: 'Beta',
		tools: [
			{ name: 'list_recommendations', description: 'Lists the context recommendations nao derived from usage.' },
			{ name: 'get_recommendation', description: 'Fetches a recommendation with what is needed to apply it.' },
			{ name: 'set_recommendation_status', description: 'Marks a recommendation as applied or dismissed.' },
		],
	},
	{
		title: 'Member budgets',
		availability: 'Admins',
		condition: 'License',
		tools: [
			{ name: 'export_member_budgets', description: 'Exports the AI usage and budget of every member as CSV.' },
		],
	},
];

export function McpToolsCard(modes: McpModes) {
	return (
		<SettingsCard
			title='Tools'
			description='Every tool the endpoint ships, and who gets it. Greyed-out groups are off with the current modes.'
			className='gap-3'
			unstyled
		>
			{MCP_TOOL_GROUPS.map((group) => (
				<McpToolGroupSection key={group.title} group={group} active={isGroupActive(group, modes)} />
			))}
		</SettingsCard>
	);
}

function McpToolGroupSection({ group, active }: { group: McpToolGroup; active: boolean }) {
	return (
		<section className='rounded-lg border border-border overflow-hidden'>
			<header className='flex items-center gap-2 bg-muted/50 px-3 py-2 border-b border-border'>
				<h3 className='text-sm font-medium text-foreground'>{group.title}</h3>
				{group.condition && <ConditionBadge label={group.condition} />}
				<Badge variant={active ? 'outline' : 'viewer'} className='ml-auto bg-background'>
					{active ? group.availability : 'Off'}
				</Badge>
			</header>
			<ul className={cn('divide-y divide-border', !active && 'opacity-50')}>
				{group.tools.map((tool) => (
					<McpToolRow key={tool.name} tool={tool} />
				))}
			</ul>
		</section>
	);
}

function McpToolRow({ tool }: { tool: McpTool }) {
	return (
		<li className='grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[13rem_1fr] text-xs'>
			<span className='font-mono font-medium text-foreground truncate'>{tool.name}</span>
			<span className='text-muted-foreground'>
				{tool.description}
				{tool.condition && <ConditionBadge label={tool.condition} className='ml-2 align-middle' />}
			</span>
		</li>
	);
}

function ConditionBadge({ label, className }: { label: string; className?: string }) {
	return (
		<Badge variant='context_admin' className={cn('px-1.5 py-0 text-[0.65rem]', className)}>
			{label}
		</Badge>
	);
}

function isGroupActive(group: McpToolGroup, modes: McpModes): boolean {
	if (!modes.endpointEnabled) {
		return false;
	}
	switch (group.requires) {
		case 'subAgent':
			return modes.subAgentModeEnabled;
		case 'contextLayer':
			return modes.contextLayerModeEnabled;
		case 'anyMode':
			return modes.subAgentModeEnabled || modes.contextLayerModeEnabled;
		default:
			return true;
	}
}
