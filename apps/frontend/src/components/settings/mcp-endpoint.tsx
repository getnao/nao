import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface ProjectItem {
	id: string;
	name: string;
}

interface Props {
	isAdmin: boolean;
	projects?: ProjectItem[];
}

export function McpEndpointSettings({ isAdmin }: Props) {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery(trpc.mcpEndpoint.getSettings.queryOptions());
	const callLogsQuery = useQuery({
		...trpc.mcpEndpoint.getCallLogs.queryOptions(),
		refetchInterval: 30_000,
		enabled: isAdmin,
	});

	const updateMutation = useMutation(
		trpc.mcpEndpoint.updateSettings.mutationOptions({
			onMutate: async (newSettings) => {
				const queryKey = trpc.mcpEndpoint.getSettings.queryOptions().queryKey;
				await queryClient.cancelQueries({ queryKey });
				const prev = queryClient.getQueryData(queryKey);
				if (prev) {
					queryClient.setQueryData(queryKey, { ...prev, ...newSettings });
				}
				return { prev };
			},
			onError: (_err, _vars, context) => {
				if (context?.prev) {
					queryClient.setQueryData(trpc.mcpEndpoint.getSettings.queryOptions().queryKey, context.prev);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.mcpEndpoint.getSettings.queryOptions().queryKey });
			},
		}),
	);

	const settings = settingsQuery.data;
	const enabled = settings?.enabled ?? true;
	const pending = updateMutation.isPending;

	const toggle = (field: string, value: boolean) => {
		updateMutation.mutate({ [field]: value });
	};

	return (
		<>
			<SettingsCard
				title='MCP Server'
				description='Allow external AI clients (Claude, Cursor, Codex, ChatGPT, etc.) to connect.'
			>
				<SettingsToggleRow
					id='mcp-enabled'
					label='Enable MCP endpoint'
					description=''
					checked={enabled}
					onCheckedChange={(v) => toggle('enabled', v)}
					disabled={!isAdmin || pending}
				/>
			</SettingsCard>

			<SettingsCard title='MCP Modes' description='Control which capabilities are exposed.'>
				<SettingsToggleRow
					id='mcp-sub-agent-mode'
					label='Sub-agent mode'
					description={renderInline(
						"Exposes `ask_nao` — delegates analytics tasks to nao's agent. The full reasoning trace is saved as a chat visible in the nao UI.",
					)}
					checked={settings?.subAgentModeEnabled ?? true}
					onCheckedChange={(v) => toggle('subAgentModeEnabled', v)}
					disabled={!isAdmin || !enabled || pending}
				/>
				<SettingsToggleRow
					id='mcp-context-layer-mode'
					label='Context-layer mode'
					description={renderInline(
						'Exposes `ls_nao_context`, `grep_nao_context`, `read_nao_context`, `execute_sql`, `create_story`, `update_story` — the client MCP drives the workflow step by step.',
					)}
					checked={settings?.contextLayerModeEnabled ?? true}
					onCheckedChange={(v) => toggle('contextLayerModeEnabled', v)}
					disabled={!isAdmin || !enabled || pending}
				/>
			</SettingsCard>

			<ConnectionCard />

			{isAdmin && (
				<CallLogsCard
					logs={callLogsQuery.data ?? []}
					isLoading={callLogsQuery.isLoading}
					isError={callLogsQuery.isError}
				/>
			)}
		</>
	);
}

type Method = {
	label?: string;
	steps: string[];
	config?: string;
	configLabel?: string;
};

type Provider = {
	id: string;
	label: string;
	methods: Method[];
};

const TOKEN_PLACEHOLDER = '<token>';

function ConnectionCard() {
	const endpointUrl = `${window.location.origin}/mcp`;

	const cursorConfig = JSON.stringify({ mcpServers: { nao: { type: 'http', url: endpointUrl } } }, null, 2);

	const claudeDesktopConfig = JSON.stringify(
		{ mcpServers: { nao: { command: 'npx', args: ['-y', 'mcp-remote', endpointUrl] } } },
		null,
		2,
	);

	const vscodeConfig = JSON.stringify({ servers: { nao: { type: 'http', url: endpointUrl } }, inputs: [] }, null, 2);

	const manualTokenConfig = JSON.stringify(
		{
			mcpServers: {
				nao: {
					type: 'http',
					url: endpointUrl,
					headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` },
				},
			},
		},
		null,
		2,
	);

	const providers: Provider[] = [
		{
			id: 'cursor',
			label: 'Cursor',
			methods: [
				{
					steps: [
						'Open {Settings > Tools & MCP}.',
						'Click `New MCP Server` and paste the JSON below — or edit `.cursor/mcp.json` manually.',
						'Authenticate in your browser when prompted.',
					],
					config: cursorConfig,
					configLabel: 'JSON config',
				},
			],
		},
		{
			id: 'codex',
			label: 'Codex',
			methods: [
				{
					steps: [
						'Open {Settings > MCP servers > + Add server > Streamable HTTP}.',
						'Paste the URL below into the URL field, then save.',
						'Authenticate in your browser when prompted.',
					],
					config: endpointUrl,
					configLabel: 'MCP Endpoint URL',
				},
			],
		},
		{
			id: 'chatgpt',
			label: 'ChatGPT',
			methods: [
				{
					steps: [
						'Open {Settings > Apps > Advanced settings}.',
						'Activate `Developer mode` if not already enabled.',
						'Click `Create app` and paste the URL below into the `MCP Server URL` field.',
						'Keep authentication as `OAuth` and click `Create`.',
						'Authenticate in your browser when prompted.',
					],
					config: endpointUrl,
					configLabel: 'MCP Endpoint URL',
				},
			],
		},
		{
			id: 'copilot',
			label: 'Copilot (VS Code)',
			methods: [
				{
					label: 'Via Settings UI',
					steps: [
						'Open {Settings > MCP Servers > +}.',
						'Paste the URL below into the `MCP Endpoint URL` field, then save.',
						'Authenticate in your browser when prompted.',
					],
					config: endpointUrl,
					configLabel: 'MCP Endpoint URL',
				},
				{
					label: 'Via config file',
					steps: [
						'Open `<your_project>/.vscode/mcp.json` (create it if missing).',
						'Paste the JSON below.',
						'Authenticate in your browser when prompted.',
					],
					config: vscodeConfig,
					configLabel: 'JSON config',
				},
			],
		},
		{
			id: 'claude-code',
			label: 'Claude Code',
			methods: [
				{
					steps: ['Open `<your_project>/.claude/settings.local.json`.', 'Paste the config below.'],
					config: manualTokenConfig,
					configLabel: 'JSON config',
				},
			],
		},
		{
			id: 'claude-desktop',
			label: 'Claude Desktop',
			methods: [
				{
					label: 'Via Settings UI',
					steps: [
						'Open {Settings > Connectors > Add custom connector}.',
						'Set `Name` to anything, and `Remote MCP Server URL` to the URL below.',
						'Enable the connector and authenticate in your browser.',
					],
					config: endpointUrl,
					configLabel: 'MCP Endpoint URL',
				},
				{
					label: 'Via config file',
					steps: [
						'Open `claude_desktop_config.json`, generally located in `~/Library/Application Support/Claude/`.',
						'Add the server using the JSON below.',
						'Restart Claude Desktop and authenticate when prompted.',
					],
					config: claudeDesktopConfig,
					configLabel: 'JSON config',
				},
			],
		},
		{
			id: 'cli',
			label: 'CLI',
			methods: [
				{
					steps: ['Use the config below in your MCP client.'],
					config: manualTokenConfig,
					configLabel: 'JSON config',
				},
			],
		},
	];

	const [active, setActive] = useState(0);
	const selected = providers[active];

	const needsToken = selected.methods.some((m) => m.config?.includes(TOKEN_PLACEHOLDER));
	const tokenQuery = useQuery({
		...trpc.mcpEndpoint.getBearerToken.queryOptions(),
		enabled: needsToken,
		staleTime: Infinity,
	});

	const resolveConfig = (config: string) => {
		if (!config.includes(TOKEN_PLACEHOLDER)) {
			return config;
		}
		const token = tokenQuery.data?.token;
		return token ? config.replaceAll(TOKEN_PLACEHOLDER, token) : config;
	};

	const goPrev = () => setActive((i) => (i === 0 ? providers.length - 1 : i - 1));
	const goNext = () => setActive((i) => (i === providers.length - 1 ? 0 : i + 1));

	return (
		<SettingsCard title='Connection guide'>
			<div className='flex flex-col gap-4'>
				<div className='flex gap-2 flex-wrap items-center'>
					{providers.map((p, i) => (
						<Button
							key={p.id}
							size='sm'
							variant={i === active ? 'primary-gradient' : 'outline'}
							onClick={() => setActive(i)}
						>
							{p.label}
						</Button>
					))}
					<div className='flex items-center gap-1.5 ml-auto'>
						<Button variant='outline' size='icon-sm' onClick={goPrev} aria-label='Previous provider'>
							<ChevronLeft className='size-3.5' />
						</Button>
						<Button variant='outline' size='icon-sm' onClick={goNext} aria-label='Next provider'>
							<ChevronRight className='size-3.5' />
						</Button>
					</div>
				</div>

				<div className='rounded-lg p-3 flex flex-col divide-y divide-border'>
					{selected.methods.map((method, i) => (
						<div
							key={i}
							className={`flex flex-col gap-3 ${i > 0 ? 'pt-3' : ''} ${i < selected.methods.length - 1 ? 'pb-3' : ''}`}
						>
							{method.label && (
								<p className='text-xs font-medium text-foreground'>
									Method {i + 1} — {method.label}
								</p>
							)}
							<StepsList steps={method.steps} />
							{method.config && (
								<ConfigBlock
									label={method.configLabel ?? 'Config'}
									text={resolveConfig(method.config)}
								/>
							)}
						</div>
					))}
				</div>
			</div>
		</SettingsCard>
	);
}

function StepsList({ steps }: { steps: string[] }) {
	return (
		<ol className='text-xs text-muted-foreground list-decimal pl-4 space-y-1'>
			{steps.map((step, i) => (
				<li key={i}>{renderInline(step)}</li>
			))}
		</ol>
	);
}

function ConfigBlock({ label, text }: { label: string; text: string }) {
	return (
		<div className='rounded-md border border-border overflow-hidden'>
			<div className='flex items-center justify-between bg-muted/60 px-2 py-1 border-b border-border'>
				<span className='text-[0.7rem] text-muted-foreground'>{label}</span>
				<CopyButton text={text} />
			</div>
			<pre className='text-xs bg-muted p-2 overflow-x-auto'>
				<code>{text}</code>
			</pre>
		</div>
	);
}

/**
 * Renders a string with two inline syntaxes:
 *  - `code` → small code badge (bg, monospace) — for file paths, JSON keys, identifiers
 *  - {Foo > Bar > Baz} → breadcrumb (no bg, monospace, › separators) — for menu paths
 */
function renderInline(text: string) {
	const parts = text.split(/(\{[^}]+\}|`[^`]+`)/g);
	return parts.map((part, i) => {
		if (part.startsWith('`') && part.endsWith('`')) {
			return (
				<code key={i} className='text-[0.7rem] text-foreground bg-muted px-1 py-0.5 rounded'>
					{part.slice(1, -1)}
				</code>
			);
		}
		if (part.startsWith('{') && part.endsWith('}')) {
			const segments = part.slice(1, -1).split(/\s*>\s*/);
			return (
				<span key={i} className='font-mono text-foreground'>
					{segments.map((seg, j) => (
						<span key={j}>
							{j > 0 && <span className='text-muted-foreground/60 mx-1'>›</span>}
							{seg}
						</span>
					))}
				</span>
			);
		}
		return <span key={i}>{part}</span>;
	});
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Button variant='outline' size='sm' onClick={handleCopy} className='shrink-0'>
			{copied ? <Check className='size-3.5 mr-1.5' /> : <Copy className='size-3.5 mr-1.5' />}
			{copied ? 'Copied' : 'Copy'}
		</Button>
	);
}

type CallLog = {
	id: string;
	userId: string;
	userName: string | null;
	toolName: string;
	durationMs: number | null;
	success: boolean;
	toolInput: unknown;
	toolOutput: unknown;
	calledAt: Date;
};

function CallLogsCard({ logs, isLoading, isError }: { logs: CallLog[]; isLoading: boolean; isError: boolean }) {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const toggle = (id: string) => setExpandedId((current) => (current === id ? null : id));

	return (
		<SettingsCard title='Recent MCP calls' description='Last 50 calls from external clients.'>
			{isLoading ? (
				<p className='text-sm text-muted-foreground text-center py-4'>Loading…</p>
			) : isError ? (
				<p className='text-sm text-destructive text-center py-4'>Failed to load MCP call logs.</p>
			) : logs.length === 0 ? (
				<p className='text-sm text-muted-foreground text-center py-4'>No MCP calls recorded yet.</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className='w-8' />
							<TableHead>Time</TableHead>
							<TableHead>User</TableHead>
							<TableHead>Tool</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{logs.map((log) => {
							const isExpanded = expandedId === log.id;
							return (
								<Fragment key={log.id}>
									<TableRow className='cursor-pointer' onClick={() => toggle(log.id)}>
										<TableCell className='text-muted-foreground'>
											<ChevronRight
												className={cn(
													'size-3.5 transition-transform',
													isExpanded && 'rotate-90',
												)}
											/>
										</TableCell>
										<TableCell className='text-xs text-muted-foreground whitespace-nowrap'>
											{formatRelativeTime(log.calledAt)}
										</TableCell>
										<TableCell className='text-sm'>{log.userName ?? 'Unknown'}</TableCell>
										<TableCell>
											<code className='text-xs'>{log.toolName}</code>
										</TableCell>
										<TableCell>
											<Badge variant={log.success ? 'outline' : 'destructive'}>
												{log.success ? 'OK' : 'Error'}
											</Badge>
										</TableCell>
									</TableRow>
									{isExpanded && (
										<TableRow className='bg-muted/30 hover:bg-muted/30'>
											<TableCell colSpan={5} className='whitespace-normal py-3'>
												<CallLogDetails log={log} />
											</TableCell>
										</TableRow>
									)}
								</Fragment>
							);
						})}
					</TableBody>
				</Table>
			)}
		</SettingsCard>
	);
}

function CallLogDetails({ log }: { log: CallLog }) {
	return (
		<div className='flex flex-col gap-3'>
			<DetailBlock label='Input'>{formatJson(log.toolInput)}</DetailBlock>
			{!log.success && (
				<DetailBlock label='Error' tone='destructive'>
					{formatJson(log.toolOutput)}
				</DetailBlock>
			)}
			{log.durationMs !== null && (
				<p className='text-[0.7rem] text-muted-foreground'>Duration: {log.durationMs}ms</p>
			)}
		</div>
	);
}

function DetailBlock({
	label,
	tone = 'default',
	children,
}: {
	label: string;
	tone?: 'default' | 'destructive';
	children: string;
}) {
	const isError = tone === 'destructive';
	return (
		<div>
			<p className={cn('text-[0.7rem] font-medium mb-1', isError ? 'text-destructive' : 'text-muted-foreground')}>
				{label}
			</p>
			<pre
				className={cn(
					'text-xs rounded p-2 overflow-x-auto whitespace-pre-wrap break-words',
					isError ? 'bg-destructive/10 text-destructive' : 'bg-muted',
				)}
			>
				<code>{children}</code>
			</pre>
		</div>
	);
}

function formatJson(value: unknown): string {
	if (value === undefined || value === null) {
		return '—';
	}
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatRelativeTime(date: Date): string {
	const diff = Date.now() - new Date(date).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) {
		return 'now';
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h`;
	}
	return `${Math.floor(hours / 24)}d`;
}
