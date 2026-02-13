import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { trpc } from '@/main';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface McpListProps {
	isAdmin: boolean;
}

export function McpList({ isAdmin }: McpListProps) {
	const mcpState = useQuery({
		...trpc.mcp.getState.queryOptions(),
		refetchOnMount: 'always',
	});
	const [expandedServers, setExpandedServers] = useState<string[]>([]);

	const reconnectMutation = useMutation(
		trpc.mcp.reconnect.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.mcp.getState.queryKey(), () => {
					return data;
				});
			},
		}),
	);

	const handleReconnect = async () => {
		await reconnectMutation.mutateAsync();
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

	const mcpEntries = mcpState.data ? Object.entries(mcpState.data) : [];

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

								return (
									<>
										<TableRow key={name}>
											<TableCell className='font-medium'>{name}</TableCell>
											<TableCell>
												<div className='flex items-center gap-2'>
													<div
														className={cn(isConnected ? 'text-green-700' : 'text-red-700')}
													>
														{isConnected ? 'Running' : 'Error'}
													</div>
												</div>
											</TableCell>
											<TableCell className='w-0'>
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
																<div className='text-sm font-medium mb-2'>
																	Tools ({state.tools.length})
																</div>
																<div className='flex flex-wrap gap-2'>
																	{state.tools.map((tool) => (
																		<Badge key={tool.name} variant='outline'>
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
		</div>
	);
}
