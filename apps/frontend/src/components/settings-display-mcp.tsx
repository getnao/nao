import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { trpc } from '@/main';

interface McpListProps {
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

export function McpList({ isAdmin }: McpListProps) {
	const mcpState = useQuery({
		...trpc.mcp.getState.queryOptions(),
		refetchOnMount: 'always',
	});
	const [expandedServers, setExpandedServers] = useState<string[]>([]);

	const reconnectMutation = useMutation(
		trpc.mcp.reconnect.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.mcp.getState.queryKey(), () => data);
			},
		}),
	);

	const toggleToolMutation = useMutation(
		trpc.mcp.toggleTool.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.mcp.getState.queryKey(), () => data);
			},
		}),
	);

	const setAllToolsMutation = useMutation(
		trpc.mcp.setAllTools.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.mcp.getState.queryKey(), () => data);
			},
		}),
	);

	const handleReconnect = async () => {
		await reconnectMutation.mutateAsync();
	};

	const handleExpand = (serverName: string) => {
		setExpandedServers((prev) =>
			prev.includes(serverName) ? prev.filter((name) => name !== serverName) : [...prev, serverName],
		);
	};

	const handleToggleTool = async (serverName: string, toolName: string, enabled: boolean) => {
		await toggleToolMutation.mutateAsync({ serverName, toolName, enabled });
	};

	const handleSetAllTools = async (serverName: string, enabled: boolean) => {
		await setAllToolsMutation.mutateAsync({ serverName, enabled });
	};

	const mcpEntries = useMemo(() => (mcpState.data ? Object.entries(mcpState.data) : []), [mcpState.data]);
	const serverStats = useMemo(() => {
		return Object.fromEntries(
			mcpEntries.map(([serverName, state]) => {
				const activeCount = state.tools.filter((tool) => tool.enabled).length;
				const totalCount = state.tools.length;
				const tokenEstimate = state.tools
					.filter((tool) => tool.enabled)
					.reduce((sum, tool) => sum + estimateToolTokens(tool), 0);
				return [serverName, { activeCount, totalCount, tokenEstimate }];
			}),
		);
	}, [mcpEntries]);

	return (
		<div className='grid gap-4'>
			<div className='flex items-center justify-between'>
				{isAdmin && (
					<Button
						onClick={handleReconnect}
						disabled={reconnectMutation.isPending}
						variant='secondary'
						size='sm'
					>
						{reconnectMutation.isPending ? (
							<>
								<Spinner />
								{mcpEntries.length === 0 ? 'Connecting...' : 'Reconnecting...'}
							</>
						) : (
							<>{mcpEntries.length === 0 ? 'Connect' : 'Reconnect'}</>
						)}
					</Button>
				)}
			</div>
			{mcpState.isLoading ? (
				<div className='text-sm text-muted-foreground'>Loading MCP servers...</div>
			) : mcpEntries.length === 0 ? (
				<div className='text-sm text-muted-foreground py-4 text-center'>
					<p className='text-lg font-medium mb-2'>No MCP Servers Connected</p>
					<p className='mb-3'>Click the Connect button above to load your configured servers.</p>
					<p>
						Set up MCP yet, add a <code className='bg-muted px-1 py-0.5 rounded'>mcp.json</code> file in your
						project&apos;s context folder at
						<code className='bg-muted px-1 py-0.5 rounded'>/agent/mcps/</code>.
					</p>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Tools</TableHead>
							<TableHead className='w-0'></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{mcpEntries.map(([name, state]) => {
							const isConnected = !state.error;
							const isExpanded = expandedServers.includes(name);
							const stats = serverStats[name] ?? { activeCount: 0, totalCount: 0, tokenEstimate: 0 };

							return (
								<TableRow key={name}>
									<TableCell className='font-medium'>{name}</TableCell>
									<TableCell>{isConnected ? 'Running' : 'Error'}</TableCell>
									<TableCell>
										<div className='flex items-center gap-2'>
											<Badge variant='outline'>
												{stats.activeCount}/{stats.totalCount} active
											</Badge>
											<Badge variant='secondary'>~{stats.tokenEstimate} tokens</Badge>
											{stats.totalCount > 0 && stats.activeCount === stats.totalCount ? (
												<span className='text-xs text-muted-foreground'>All active</span>
											) : null}
										</div>
									</TableCell>
									<TableCell className='w-0'>
										<Button variant='ghost' size='icon-sm' onClick={() => handleExpand(name)}>
											{isExpanded ? <ChevronUp className='size-4' /> : <ChevronDown className='size-4' />}
										</Button>
									</TableCell>
								</TableRow>
							);
						})}

						{mcpEntries.map(([name, state]) => {
							const isExpanded = expandedServers.includes(name);
							if (!isExpanded) {
								return null;
							}

							return (
								<TableRow key={`${name}-tools`}>
									<TableCell colSpan={4} className='bg-muted/50'>
										<div className='py-2 space-y-3'>
											{state.error ? (
												<div className='text-sm text-red-500'>{state.error}</div>
											) : (
												<>
													<div className='flex items-center justify-between'>
														<div className='text-sm font-medium'>Tools ({state.tools.length})</div>
														{isAdmin && (
															<Button
																variant='outline'
																size='sm'
																onClick={() => handleSetAllTools(name, false)}
																disabled={setAllToolsMutation.isPending}
															>
																Disable all
															</Button>
														)}
													</div>
													<div className='grid gap-2'>
														{state.tools.map((tool) => (
															<div
																key={tool.name}
																className='flex items-center justify-between rounded-md border px-3 py-2 bg-background'
															>
																<div className='min-w-0'>
																	<div className='text-sm font-medium truncate'>{tool.name}</div>
																	{tool.description ? (
																		<div className='text-xs text-muted-foreground line-clamp-2'>
																			{tool.description}
																		</div>
																	) : null}
																</div>
																<Switch
																	checked={tool.enabled}
																	onCheckedChange={(checked) => handleToggleTool(name, tool.name, checked)}
																	disabled={!isAdmin || toggleToolMutation.isPending}
																/>
															</div>
														))}
													</div>
												</>
											)}
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</div>
	);
}
