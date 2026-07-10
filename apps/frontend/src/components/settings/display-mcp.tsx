import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SettingsCard } from '../ui/settings-card';
import type { McpServerStatus, McpToolSummary } from '@nao/shared';
import { trpc } from '@/main';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useMcpContext } from '@/contexts/mcp';
import { McpServerIcon } from '@/components/mcp-server-icon';
import { openMcpConnectPopup } from '@/lib/mcp-oauth';

interface Props {
	isAdmin: boolean;
}

type ToolCategory = 'read-only' | 'write' | 'delete' | 'unknown';

const CATEGORY_ORDER: ToolCategory[] = ['read-only', 'write', 'delete', 'unknown'];

const CATEGORY_META: Record<ToolCategory, { label: string; className: string }> = {
	'read-only': { label: 'Read-only', className: 'bg-green-500/10 text-green-600' },
	write: { label: 'Write', className: 'bg-amber-500/10 text-amber-600' },
	delete: { label: 'Delete', className: 'bg-red-500/10 text-red-600' },
	unknown: { label: 'Unknown', className: 'bg-muted text-muted-foreground' },
};

const READ_ONLY_VERBS = new Set([
	'get',
	'list',
	'read',
	'fetch',
	'search',
	'query',
	'find',
	'describe',
	'show',
	'view',
	'retrieve',
	'count',
	'lookup',
	'scan',
	'export',
	'download',
	'preview',
	'inspect',
	'check',
	'browse',
	'explore',
]);

const WRITE_VERBS = new Set([
	'create',
	'update',
	'write',
	'set',
	'add',
	'insert',
	'put',
	'patch',
	'post',
	'upsert',
	'edit',
	'modify',
	'append',
	'rename',
	'move',
	'copy',
	'enable',
	'disable',
	'send',
	'run',
	'execute',
	'exec',
	'trigger',
	'start',
	'stop',
	'restart',
	'import',
	'upload',
	'sync',
	'refresh',
	'save',
	'publish',
	'schedule',
	'assign',
	'apply',
	'generate',
	'register',
	'submit',
	'duplicate',
]);

const DELETE_VERBS = new Set([
	'delete',
	'remove',
	'drop',
	'purge',
	'destroy',
	'clear',
	'truncate',
	'revoke',
	'uninstall',
	'cancel',
	'unregister',
	'deregister',
]);

const categorizeTool = (name: string): ToolCategory => {
	const tokens = name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^a-zA-Z0-9]+/)
		.map((token) => token.toLowerCase())
		.filter(Boolean);

	for (const token of tokens) {
		if (DELETE_VERBS.has(token)) {
			return 'delete';
		}
		if (WRITE_VERBS.has(token)) {
			return 'write';
		}
		if (READ_ONLY_VERBS.has(token)) {
			return 'read-only';
		}
	}
	return 'unknown';
};

const groupToolsByCategory = (tools: McpToolSummary[]): { category: ToolCategory; tools: McpToolSummary[] }[] => {
	const groups = new Map<ToolCategory, McpToolSummary[]>();
	for (const tool of tools) {
		const category = categorizeTool(tool.name);
		const existing = groups.get(category) ?? [];
		existing.push(tool);
		groups.set(category, existing);
	}

	return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
		category,
		tools: groups.get(category)!.sort((a, b) => a.name.localeCompare(b.name)),
	}));
};

function McpOAuthConnect({
	server,
	isAdmin,
	onConnected,
}: {
	server: McpServerStatus;
	isAdmin: boolean;
	onConnected: () => void;
}) {
	const [connecting, setConnecting] = useState(false);

	const handleConnect = async () => {
		setConnecting(true);
		const ok = await openMcpConnectPopup(server.name);
		setConnecting(false);
		if (ok) {
			onConnected();
		}
	};

	if (server.oauthConnected) {
		return <Badge className='bg-green-500/10 text-green-600'>OAuth connected</Badge>;
	}

	if (!isAdmin) {
		return <Badge className='bg-amber-500/10 text-amber-600'>OAuth required</Badge>;
	}

	return (
		<Button variant='secondary' size='sm' onClick={handleConnect} disabled={connecting} isLoading={connecting}>
			Connect
		</Button>
	);
}

const isWaitingForConnection = (server: McpServerStatus): boolean =>
	!!server.error && /connection required/i.test(server.error);

const connectionLabel = (server: McpServerStatus): { label: string; className: string } => {
	if (isWaitingForConnection(server)) {
		return { label: 'Waiting for connection', className: 'text-orange-500' };
	}
	if (server.error) {
		return { label: 'Error', className: 'text-red-700' };
	}
	if (server.connectionOk) {
		return { label: 'Connected', className: 'text-green-700' };
	}
	if (server.discovered) {
		return { label: 'Cached', className: 'text-muted-foreground' };
	}
	return { label: 'Not tested', className: 'text-muted-foreground' };
};

export function McpSettings({ isAdmin }: Props) {
	const { servers, configError, refresh } = useMcpContext();
	const [expandedServers, setExpandedServers] = useState<string[]>([]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const discoverMutation = useMutation(
		trpc.mcp.discover.mutationOptions({
			onSuccess: () => refresh(),
		}),
	);

	const discoverServerMutation = useMutation(
		trpc.mcp.discoverServer.mutationOptions({
			onSuccess: () => refresh(),
		}),
	);

	const setServerEnabledMutation = useMutation(
		trpc.mcp.setServerEnabled.mutationOptions({
			onSuccess: () => refresh(),
		}),
	);

	const setToolEnabledMutation = useMutation(
		trpc.mcp.setToolEnabled.mutationOptions({
			onSuccess: () => refresh(),
		}),
	);

	const setToolsEnabledMutation = useMutation(
		trpc.mcp.setToolsEnabled.mutationOptions({
			onSuccess: () => refresh(),
		}),
	);

	const handleExpand = (serverName: string) => {
		setExpandedServers((prev) =>
			prev.includes(serverName) ? prev.filter((name) => name !== serverName) : [...prev, serverName],
		);
	};

	return (
		<SettingsCard
			title='MCP Servers'
			description='Configure MCP servers in agent/mcps/mcp.json. Test the connection here and choose which tools the agent may use. nao discovers enabled tools into OpenAPI specs the agent explores on demand — tools are never loaded into the context window.'
			action={
				isAdmin && (
					<Button
						onClick={() => discoverMutation.mutate()}
						disabled={discoverMutation.isPending}
						isLoading={discoverMutation.isPending}
						variant='secondary'
						size='sm'
					>
						Connect all MCP servers
					</Button>
				)
			}
		>
			{configError && (
				<div className='mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600'>
					<p className='font-medium'>Could not read agent/mcps/mcp.json</p>
					<p className='mt-1 break-words font-mono text-xs'>{configError}</p>
				</div>
			)}
			{servers === undefined ? (
				<div className='text-sm text-muted-foreground'>Loading MCP servers...</div>
			) : servers.length === 0 ? (
				!configError && (
					<div className='text-sm text-muted-foreground py-4 text-center'>
						<p className='text-lg font-medium mb-2'>No MCP Servers Configured</p>
						<p>
							Add a <code className='bg-muted px-1 py-0.5 rounded'>mcp.json</code> file in your project's
							context folder at <code className='bg-muted px-1 py-0.5 rounded'>/agent/mcps/</code>, then
							click Connect all MCP servers.
						</p>
					</div>
				)
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Transport</TableHead>
							<TableHead>Connection</TableHead>
							<TableHead>Tools</TableHead>
							<TableHead>Enabled</TableHead>
							<TableHead className='w-0'></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{servers.map((server) => {
							const isExpanded = expandedServers.includes(server.name);
							const connection = connectionLabel(server);

							return (
								<>
									<TableRow key={server.name}>
										<TableCell className='font-medium'>
											<div className='flex items-center gap-2'>
												<McpServerIcon server={server.name} className='size-4' />
												{server.name}
											</div>
										</TableCell>
										<TableCell>
											<span className='text-xs text-muted-foreground'>{server.transport}</span>
										</TableCell>
										<TableCell>
											<div className='flex items-center gap-2'>
												<span className={connection.className}>{connection.label}</span>
												{server.oauth && (
													<McpOAuthConnect
														server={server}
														isAdmin={isAdmin}
														onConnected={refresh}
													/>
												)}
											</div>
										</TableCell>
										<TableCell className='text-sm text-muted-foreground'>
											{server.enabledToolCount}/{server.toolCount}
										</TableCell>
										<TableCell>
											<Switch
												checked={server.enabled}
												disabled={!isAdmin || setServerEnabledMutation.isPending}
												onCheckedChange={(enabled) =>
													setServerEnabledMutation.mutate({
														serverName: server.name,
														enabled,
													})
												}
											/>
										</TableCell>
										<TableCell className='w-0'>
											<div className='flex items-center gap-1'>
												{isAdmin && (
													<Button
														variant='ghost'
														size='icon-sm'
														title='Connect this server'
														onClick={() =>
															discoverServerMutation.mutate({ serverName: server.name })
														}
														disabled={
															discoverServerMutation.isPending &&
															discoverServerMutation.variables?.serverName === server.name
														}
													>
														<RefreshCw
															className={
																discoverServerMutation.isPending &&
																discoverServerMutation.variables?.serverName ===
																	server.name
																	? 'size-4 animate-spin'
																	: 'size-4'
															}
														/>
													</Button>
												)}
												<Button
													variant='ghost'
													size='icon-sm'
													onClick={() => handleExpand(server.name)}
												>
													{isExpanded ? (
														<ChevronUp className='size-4' />
													) : (
														<ChevronDown className='size-4' />
													)}
												</Button>
											</div>
										</TableCell>
									</TableRow>
									{isExpanded && (
										<TableRow>
											<TableCell colSpan={6} className='bg-muted/50 whitespace-normal'>
												<div className='py-2 flex flex-col gap-3'>
													{server.error && (
														<div
															className={
																isWaitingForConnection(server)
																	? 'text-sm text-orange-500'
																	: 'text-sm text-red-500'
															}
														>
															{server.error}
														</div>
													)}
													<div className='text-xs text-muted-foreground'>
														Specs:{' '}
														<code className='bg-muted px-1 py-0.5 rounded'>
															{server.specPath}
														</code>
													</div>
													{server.tools.length > 0 ? (
														<div className='flex flex-col gap-4'>
															{groupToolsByCategory(server.tools).map(
																({ category, tools }) => (
																	<div key={category} className='flex flex-col gap-1'>
																		<div className='flex items-center justify-between gap-2 px-2'>
																			<div className='flex items-center gap-2'>
																				<Badge
																					className={
																						CATEGORY_META[category]
																							.className
																					}
																				>
																					{CATEGORY_META[category].label}
																				</Badge>
																				<span className='text-xs text-muted-foreground'>
																					{
																						tools.filter((t) => t.enabled)
																							.length
																					}
																					/{tools.length}
																				</span>
																			</div>
																			<Switch
																				checked={tools.every((t) => t.enabled)}
																				disabled={
																					!isAdmin ||
																					!server.enabled ||
																					setToolsEnabledMutation.isPending
																				}
																				onCheckedChange={(enabled) =>
																					setToolsEnabledMutation.mutate({
																						serverName: server.name,
																						toolNames: tools.map(
																							(t) => t.name,
																						),
																						enabled,
																					})
																				}
																			/>
																		</div>
																		{tools.map((tool) => (
																			<div
																				key={tool.name}
																				className='flex items-start justify-between gap-4 rounded px-2 py-1 hover:bg-background/50'
																			>
																				<div className='flex min-w-0 flex-1 flex-col'>
																					<span className='text-sm font-medium'>
																						{tool.name}
																					</span>
																					{tool.description && (
																						<span
																							className='text-xs text-muted-foreground break-words line-clamp-2'
																							title={tool.description}
																						>
																							{tool.description}
																						</span>
																					)}
																				</div>
																				<div className='shrink-0 pt-0.5'>
																					<Switch
																						checked={tool.enabled}
																						disabled={
																							!isAdmin ||
																							!server.enabled ||
																							setToolEnabledMutation.isPending
																						}
																						onCheckedChange={(enabled) =>
																							setToolEnabledMutation.mutate(
																								{
																									serverName:
																										server.name,
																									toolName: tool.name,
																									enabled,
																								},
																							)
																						}
																					/>
																				</div>
																			</div>
																		))}
																	</div>
																),
															)}
														</div>
													) : (
														!server.error && (
															<div className='text-sm text-muted-foreground'>
																No tools discovered yet. Click Connect all MCP servers.
															</div>
														)
													)}
												</div>
											</TableCell>
										</TableRow>
									)}
								</>
							);
						})}
					</TableBody>
				</Table>
			)}
		</SettingsCard>
	);
}
