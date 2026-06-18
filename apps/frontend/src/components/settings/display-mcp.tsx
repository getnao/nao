import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SettingsCard } from '../ui/settings-card';
import { trpc } from '@/main';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useMcpContext } from '@/contexts/mcp';
import { getActiveProjectId } from '@/lib/active-project';

interface Props {
	isAdmin: boolean;
}

const estimateToolTokens = (tool: { name: string; description?: string; input_schema: unknown }) => {
	const serialized = JSON.stringify({
		name: tool.name,
		description: tool.description ?? '',
		schema: tool.input_schema ?? {},
	});
	return Math.ceil(serialized.length / 4);
};

export function McpSettings({ isAdmin }: Props) {
	const { mcpState, fetchMcpState } = useMcpContext();
	const [expandedServers, setExpandedServers] = useState<string[]>([]);

	useEffect(() => {
		fetchMcpState();
	}, [fetchMcpState]);

	const reconnectMutation = useMutation(
		trpc.mcp.reconnect.mutationOptions({
			onSuccess: () => fetchMcpState(),
		}),
	);

	const toggleToolMutation = useMutation(
		trpc.mcp.toggleTool.mutationOptions({
			onSuccess: () => fetchMcpState(),
		}),
	);

	const setAllServerToolsMutation = useMutation(
		trpc.mcp.setAllServerTools.mutationOptions({
			onSuccess: () => fetchMcpState(),
		}),
	);

	const handleReconnect = async () => {
		await reconnectMutation.mutateAsync();
	};

	const handleToggleTool = (toolName: string, enabled: boolean) => {
		toggleToolMutation.mutate({ toolName, enabled });
	};

	const handleExpand = (serverName: string) => {
		setExpandedServers((prev) => {
			if (prev.includes(serverName)) {
				return prev.filter((name) => name !== serverName);
			} else {
				return [...prev, serverName];
			}
		});
	};

	const handleSetAllServerTools = (serverName: string, enabled: boolean) => {
		setAllServerToolsMutation.mutate({ serverName, enabled });
	};

	const oauthStatusQuery = useQuery(trpc.mcp.oauthStatus.queryOptions());
	const oauthByServer = new Map((oauthStatusQuery.data ?? []).map((status) => [status.serverName, status.connected]));
	const [connectingServer, setConnectingServer] = useState<string | null>(null);
	const [oauthError, setOauthError] = useState<string | null>(null);

	const disconnectOAuthMutation = useMutation(
		trpc.mcp.disconnectOAuth.mutationOptions({
			onSuccess: () => {
				oauthStatusQuery.refetch();
				fetchMcpState();
			},
		}),
	);

	const handleConnectOAuth = async (serverName: string) => {
		const projectId = getActiveProjectId();
		if (!projectId) {
			return;
		}
		setConnectingServer(serverName);
		setOauthError(null);
		try {
			const returnTo = '/settings/project/mcp-servers';
			const response = await fetch(
				`/api/mcp-oauth/connect/${projectId}/${encodeURIComponent(serverName)}?returnTo=${encodeURIComponent(returnTo)}`,
				{ credentials: 'include' },
			);
			if (!response.ok) {
				throw new Error('request failed');
			}
			const result = (await response.json()) as { status: string; authorizationUrl?: string };
			if (result.status === 'redirect' && result.authorizationUrl) {
				window.location.href = result.authorizationUrl;
				return;
			}
			await oauthStatusQuery.refetch();
		} catch {
			setOauthError(`Could not start the connection for ${serverName}.`);
		} finally {
			setConnectingServer(null);
		}
	};

	const handleDisconnectOAuth = (serverName: string) => {
		disconnectOAuthMutation.mutate({ serverName });
	};

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const status = params.get('mcp');
		if (!status) {
			return;
		}
		if (status === 'error') {
			setOauthError(`Connection failed: ${params.get('reason') ?? 'unknown error'}.`);
		}
		oauthStatusQuery.refetch();
		['mcp', 'server', 'reason'].forEach((key) => params.delete(key));
		const search = params.toString();
		window.history.replaceState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const mcpEntries = mcpState ? Object.entries(mcpState) : [];

	return (
		<SettingsCard
			title='MCP Servers'
			description='Integrate MCP servers to extend the capabilities of nao.'
			action={
				isAdmin && (
					<Button
						onClick={handleReconnect}
						disabled={reconnectMutation.isPending}
						isLoading={reconnectMutation.isPending}
						variant='secondary'
						size='sm'
					>
						{mcpEntries.length === 0 ? 'Connect' : 'Reconnect'}
					</Button>
				)
			}
		>
			{oauthError && <div className='mb-3 text-sm text-red-500'>{oauthError}</div>}
			{mcpState === undefined ? (
				<div className='text-sm text-muted-foreground'>Loading MCP servers...</div>
			) : mcpEntries.length === 0 ? (
				<div className='text-sm text-muted-foreground py-4 text-center'>
					<p className='text-lg font-medium mb-2'>No MCP Servers Connected</p>
					<p className='mb-3'>Click the Connect button above to load your configured servers.</p>
					<p>
						Set up MCP yet, add a <code className='bg-muted px-1 py-0.5 rounded'>mcp.json</code> file in
						your project's context folder at
						<code className='bg-muted px-1 py-0.5 rounded'>/agent/mcps/</code>.
					</p>
				</div>
			) : (
				<div className='flex flex-col gap-4'>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className='w-0'></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{mcpEntries.map(([name, state]) => {
								const isConnected = !state.error;
								const isExpanded = expandedServers.includes(name);
								const enabledCount = state.tools.filter((t) => t.enabled).length;
								const totalCount = state.tools.length;
								const isOAuth = oauthByServer.has(name);
								const isOAuthConnected = oauthByServer.get(name) === true;

								return (
									<>
										<TableRow key={name}>
											<TableCell className='font-medium'>{name}</TableCell>
											<TableCell>
												<div className='flex items-center gap-2'>
													{isOAuth ? (
														<div
															className={cn(
																isOAuthConnected
																	? 'text-green-700'
																	: 'text-muted-foreground',
															)}
														>
															{isOAuthConnected ? 'Connected' : 'Not connected'}
														</div>
													) : (
														<div
															className={cn(
																isConnected ? 'text-green-700' : 'text-red-700',
															)}
														>
															{isConnected ? 'Running' : 'Error'}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell className='w-0'>
												<div className='flex items-center justify-end gap-2'>
													{isOAuth &&
														(isOAuthConnected ? (
															<Button
																variant='ghost'
																size='sm'
																onClick={() => handleDisconnectOAuth(name)}
																disabled={disconnectOAuthMutation.isPending}
															>
																Disconnect
															</Button>
														) : (
															<Button
																variant='secondary'
																size='sm'
																onClick={() => handleConnectOAuth(name)}
																isLoading={connectingServer === name}
															>
																Connect
															</Button>
														))}
													<Button
														variant='ghost'
														size='icon-sm'
														onClick={() => handleExpand(name)}
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
												<TableCell colSpan={3} className='bg-muted/50'>
													<div className='py-2'>
														{state.error ? (
															<div className='text-sm text-red-500 mb-2'>
																{state.error}
															</div>
														) : (
															<>
																<div className='flex items-center justify-between mb-2'>
																	<div className=' flex gap-4 text-sm font-medium'>
																		<div>
																			{enabledCount} / {totalCount} tools active
																		</div>
																		<div>
																			~
																			{state.tools
																				.filter((t) => t.enabled)
																				.reduce(
																					(sum, t) =>
																						sum + estimateToolTokens(t),
																					0,
																				)}{' '}
																			tokens
																		</div>
																	</div>
																	{isAdmin && (
																		<Button
																			variant='ghost'
																			size='sm'
																			onClick={() =>
																				handleSetAllServerTools(
																					name,
																					enabledCount === 0,
																				)
																			}
																			disabled={
																				setAllServerToolsMutation.isPending
																			}
																		>
																			{enabledCount > 0
																				? 'Disable all'
																				: 'Enable all'}
																		</Button>
																	)}
																</div>
																<div className='text-sm font-medium mb-2'>
																	Tools ({state.tools.length})
																</div>
																<div className='flex flex-wrap gap-2'>
																	{state.tools.map((tool) => (
																		<Badge
																			key={tool.name}
																			variant='outline'
																			onClick={() =>
																				isAdmin &&
																				handleToggleTool(
																					tool.name,
																					!tool.enabled,
																				)
																			}
																			className={cn(
																				isAdmin && 'cursor-pointer select-none',
																				!tool.enabled
																					? 'border-border text-muted-foreground line-through'
																					: '',
																			)}
																		>
																			{tool.name}
																		</Badge>
																	))}
																</div>
															</>
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
				</div>
			)}
		</SettingsCard>
	);
}
