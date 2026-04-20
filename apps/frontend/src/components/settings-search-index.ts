export interface SettingsSearchEntry {
	page: string;
	pageLabel: string;
	section?: string;
	title: string;
	description?: string;
	keywords?: string[];
	adminOnly?: boolean;
	cloudHidden?: boolean;
}

export const settingsSearchIndex: SettingsSearchEntry[] = [
	// ── Account ──────────────────────────────────────────────
	{
		page: '/settings/account',
		pageLabel: 'Account',
		title: 'Profile',
		description: 'Manage your name, email, and sign out.',
		keywords: ['name', 'email', 'sign out', 'logout', 'avatar'],
	},
	{
		page: '/settings/account',
		pageLabel: 'Account',
		section: 'General Settings',
		title: 'Sound notification',
		description: 'Play a sound when the agent finishes responding.',
		keywords: ['audio', 'alert', 'notification sound'],
	},
	{
		page: '/settings/account',
		pageLabel: 'Account',
		section: 'General Settings',
		title: 'Theme',
		description: 'Choose how nao looks.',
		keywords: ['dark mode', 'light mode', 'appearance', 'color scheme'],
	},
	{
		page: '/settings/account',
		pageLabel: 'Account',
		title: 'Danger Zone',
		description: 'Delete your account or perform other destructive actions.',
		keywords: ['delete account', 'remove'],
	},

	// ── Organization ─────────────────────────────────────────
	{
		page: '/settings/organization',
		pageLabel: 'Organization',
		title: 'Members',
		description: 'Manage the members of your organization.',
		keywords: ['users', 'invite', 'add member', 'roles', 'team'],
	},
	{
		page: '/settings/organization',
		pageLabel: 'Organization',
		title: 'Projects',
		description: 'See every project in your organization and the access you have to each one.',
		keywords: ['project list', 'access'],
	},
	{
		page: '/settings/organization',
		pageLabel: 'Organization',
		title: 'Import from GitHub',
		description: 'Connect your GitHub account and import a repository as a project.',
		keywords: ['github', 'repository', 'repo', 'import', 'git', 'integration', 'clone'],
	},
	{
		page: '/settings/organization',
		pageLabel: 'Organization',
		title: 'Organization API Keys',
		description: 'Generate organization-scoped API keys for actions like deploying a project from the nao CLI.',
		keywords: ['api key', 'deploy key', 'token', 'credentials'],
	},

	// ── Project > General ────────────────────────────────────
	{
		page: '/settings/project',
		pageLabel: 'Project',
		title: 'Project Information',
		description: 'View your project name and path.',
		keywords: ['project name', 'project path'],
		adminOnly: true,
	},
	{
		page: '/settings/project',
		pageLabel: 'Project',
		title: 'Repository',
		description: 'View linked GitHub repository and pull latest changes.',
		keywords: ['github', 'git', 'pull', 'sync', 'repository', 'refresh'],
		adminOnly: true,
	},
	{
		page: '/settings/project',
		pageLabel: 'Project',
		title: 'Environment Variables',
		description: 'Set environment variables referenced in nao_config.yaml.',
		keywords: ['env', 'environment', 'variable', 'secret', 'credential', 'config', 'jinja'],
		adminOnly: true,
	},
	{
		page: '/settings/project',
		pageLabel: 'Project',
		title: 'Google Credentials',
		description: 'Configure Google service account credentials for BigQuery and other Google services.',
		keywords: ['google', 'bigquery', 'service account', 'gcp'],
		adminOnly: true,
	},

	// ── Project > Models ─────────────────────────────────────
	{
		page: '/settings/project/models',
		pageLabel: 'Models',
		title: 'LLM Configuration',
		description: 'Configure the LLM providers for the agent in this project.',
		keywords: ['openai', 'anthropic', 'google', 'llm', 'model', 'provider', 'api key'],
		adminOnly: true,
	},
	{
		page: '/settings/project/models',
		pageLabel: 'Models',
		title: 'Transcription',
		description: 'Configure speech-to-text transcription provider and model.',
		keywords: ['voice', 'speech', 'microphone', 'whisper', 'stt'],
		adminOnly: true,
	},

	// ── Project > Agent ──────────────────────────────────────
	{
		page: '/settings/project/agent',
		pageLabel: 'Agent',
		section: 'Memory',
		title: 'Project Memory',
		description: 'Memories enable nao to remember preferences and facts about team members.',
		keywords: ['remember', 'learn', 'personalization'],
		adminOnly: true,
	},
	{
		page: '/settings/project/agent',
		pageLabel: 'Agent',
		title: 'Web search',
		description: 'Allow the agent to search the web for up-to-date information when answering questions.',
		keywords: ['internet', 'browse', 'fetch', 'online'],
		adminOnly: true,
	},
	{
		page: '/settings/project/agent',
		pageLabel: 'Agent',
		title: 'Saved Prompts',
		description: 'Save repeatable, customizable prompts for the agent to follow.',
		keywords: ['prompt template', 'instruction', 'preset'],
		adminOnly: true,
	},
	{
		page: '/settings/project/agent',
		pageLabel: 'Agent',
		section: 'Experimental',
		title: 'Python sandboxing',
		description: 'Allow the agent to execute Python code in a secure sandboxed environment.',
		keywords: ['code execution', 'sandbox', 'python'],
		adminOnly: true,
	},
	{
		page: '/settings/project/agent',
		pageLabel: 'Agent',
		section: 'Experimental',
		title: 'Sandboxes',
		description: 'Allow the agent to use sandboxes to run code in a secure environment. Works with Boxlite.',
		keywords: ['boxlite', 'code execution'],
		adminOnly: true,
	},
	{
		page: '/settings/project/agent',
		pageLabel: 'Agent',
		section: 'Experimental',
		title: 'Dangerous write permissions',
		description: 'Allow the agent to execute INSERT, UPDATE, DELETE and DDL SQL queries.',
		keywords: ['write', 'insert', 'update', 'delete', 'ddl', 'sql', 'permissions'],
		adminOnly: true,
	},

	// ── Project > MCP Servers ────────────────────────────────
	{
		page: '/settings/project/mcp-servers',
		pageLabel: 'MCP Servers',
		title: 'MCP Servers',
		description: 'Integrate MCP servers to extend the capabilities of nao.',
		keywords: ['model context protocol', 'tool', 'integration', 'extension'],
		adminOnly: true,
	},

	// ── Project > Slack ──────────────────────────────────────
	{
		page: '/settings/project/slack',
		pageLabel: 'Slack',
		title: 'Slack Integration',
		description: 'Configure Slack app credentials, webhook, and bot behavior.',
		keywords: ['slack bot', 'slack app', 'slack webhook', 'messaging'],
		adminOnly: true,
	},

	// ── Project > Microsoft Teams ────────────────────────────
	{
		page: '/settings/project/teams',
		pageLabel: 'Microsoft Teams',
		title: 'Microsoft Teams Integration',
		description: 'Configure Teams app credentials, messaging endpoint, and bot behavior.',
		keywords: ['teams bot', 'azure bot', 'teams app', 'messaging'],
		adminOnly: true,
	},

	// ── Project > Telegram ───────────────────────────────────
	{
		page: '/settings/project/telegram',
		pageLabel: 'Telegram',
		title: 'Telegram Integration',
		description: 'Configure Telegram bot credentials, webhook, and bot behavior.',
		keywords: ['telegram bot', 'telegram webhook', 'messaging'],
		adminOnly: true,
	},
	{
		page: '/settings/project/telegram',
		pageLabel: 'Telegram',
		title: 'Linking Code',
		description: 'Send /login <code> to the Telegram bot you want to link.',
		keywords: ['link', 'login', 'telegram'],
	},

	// ── Project > WhatsApp ───────────────────────────────────
	{
		page: '/settings/project/whatsapp',
		pageLabel: 'WhatsApp',
		title: 'WhatsApp Integration',
		description: 'Configure WhatsApp app credentials, webhook, and bot behavior.',
		keywords: ['whatsapp bot', 'whatsapp webhook', 'messaging'],
		adminOnly: true,
	},
	{
		page: '/settings/project/whatsapp',
		pageLabel: 'WhatsApp',
		title: 'Linking Code',
		description: 'Send /login <code> from the WhatsApp number you want to link.',
		keywords: ['link', 'login', 'phone number'],
		adminOnly: true,
	},

	// ── Project > Team ───────────────────────────────────────
	{
		page: '/settings/project/team',
		pageLabel: 'Team',
		title: 'Team Members',
		description: 'Manage the members of your project.',
		keywords: ['users', 'invite', 'add member', 'roles', 'project members'],
		adminOnly: true,
	},

	// ── Usage & Costs ────────────────────────────────────────
	{
		page: '/settings/usage',
		pageLabel: 'Usage & Costs',
		title: 'Messages',
		description: 'How many messages have been sent across all chats?',
		keywords: ['usage', 'analytics', 'statistics'],
		adminOnly: true,
	},
	{
		page: '/settings/usage',
		pageLabel: 'Usage & Costs',
		title: 'Tokens',
		description: 'Tokens used across all chats.',
		keywords: ['token usage', 'input tokens', 'output tokens'],
		adminOnly: true,
	},
	{
		page: '/settings/usage',
		pageLabel: 'Usage & Costs',
		title: 'Cost',
		description: 'Estimated cost in USD based on token usage and model pricing.',
		keywords: ['price', 'billing', 'expense', 'spending'],
		adminOnly: true,
	},
	{
		page: '/settings/usage',
		pageLabel: 'Usage & Costs',
		title: 'Feedbacks',
		description: 'Feedbacks users have given to the agent during their sessions.',
		keywords: ['thumbs up', 'thumbs down', 'rating', 'review'],
		adminOnly: true,
	},

	// ── Chats Replay ─────────────────────────────────────────
	{
		page: '/settings/chats-replay',
		pageLabel: 'Chats Replay',
		title: 'Chats Replay',
		description: 'Replay and review past chat conversations.',
		keywords: ['history', 'conversation', 'replay', 'review'],
		adminOnly: true,
	},

	// ── Logs ─────────────────────────────────────────────────
	{
		page: '/settings/logs',
		pageLabel: 'Logs',
		title: 'Logs',
		description: 'Real-time backend logs with auto-refresh.',
		keywords: ['error', 'warn', 'debug', 'info', 'terminal', 'console'],
		adminOnly: true,
		cloudHidden: true,
	},

	// ── Memory (user-level) ──────────────────────────────────
	{
		page: '/settings/memory',
		pageLabel: 'Memory',
		title: 'Memory',
		description: 'Memories enables nao to learn about you and your preferences over time.',
		keywords: ['remember', 'learn', 'personalization', 'preferences'],
	},
	{
		page: '/settings/memory',
		pageLabel: 'Memory',
		title: 'Saved Memories',
		description: 'Review and manage memory preferences and what the agent has remembered.',
		keywords: ['remembered facts', 'memory list'],
	},

	// ── Context Explorer ─────────────────────────────────────
	{
		page: '/settings/context-explorer',
		pageLabel: 'File Explorer',
		title: 'File Explorer',
		description: 'Browse and inspect the files and context available to the agent.',
		keywords: ['files', 'context', 'documents', 'knowledge base'],
		adminOnly: true,
	},
];
