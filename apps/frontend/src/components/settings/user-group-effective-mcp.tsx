import { isMcpServerFullyGranted, isMcpServerGranted, isMcpToolGranted } from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { McpAccess, McpServerStatus } from '@nao/shared';

import { EffectiveAccessStatusRow } from '@/components/settings/user-group-effective-access-status-row';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export function UserGroupEffectiveMcp({ mcpAccess }: { mcpAccess: McpAccess }) {
	const servers = useQuery(trpc.mcp.getServers.queryOptions());
	const configuredServers = servers.data ?? [];
	const grantedServers = configuredServers.filter((server) => isMcpServerGranted(mcpAccess, server.name));

	return (
		<div className='flex flex-col gap-4'>
			<div>
				<h4 className='text-sm font-medium'>Effective MCP access</h4>
				<p className='text-xs text-muted-foreground'>
					MCP servers and tools this user can use in chats, Slack, and automations, combined from all
					applicable groups.
				</p>
			</div>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant='secondary'>{mcpAccess.mode === 'all' ? 'Everything' : 'Specific selection'}</Badge>
				{servers.isSuccess && (
					<span className='text-xs text-muted-foreground'>
						{grantedServers.length} of {configuredServers.length}{' '}
						{configuredServers.length === 1 ? 'server' : 'servers'}
					</span>
				)}
			</div>
			<ul className='divide-y rounded-lg border'>
				{servers.isLoading ? (
					<EffectiveAccessStatusRow message='Loading MCP servers...' />
				) : servers.isError ? (
					<EffectiveAccessStatusRow
						message='Failed to load MCP servers'
						onRetry={() => void servers.refetch()}
					/>
				) : configuredServers.length === 0 ? (
					<EffectiveAccessStatusRow message='No MCP servers configured in agent/mcps/mcp.json.' />
				) : grantedServers.length === 0 ? (
					<EffectiveAccessStatusRow message='No MCP servers are available to this user.' />
				) : (
					grantedServers.map((server) => (
						<EffectiveMcpServerRow key={server.name} server={server} access={mcpAccess} />
					))
				)}
			</ul>
		</div>
	);
}

function EffectiveMcpServerRow({ server, access }: { server: McpServerStatus; access: McpAccess }) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const grantedTools = server.tools.filter((tool) => isMcpToolGranted(access, server.name, tool.name));
	const fullyGranted = isMcpServerFullyGranted(access, server.name);

	return (
		<li>
			<div className='flex min-h-10 items-center gap-2 px-3 py-2'>
				<button
					type='button'
					className='flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:invisible'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${server.name} tools`}
					aria-expanded={open}
					aria-controls={panelId}
					disabled={grantedTools.length === 0}
					onClick={() => setOpen(!open)}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<span className='min-w-0 flex-1 truncate text-sm font-medium' title={server.name}>
					{server.name}
				</span>
				{!server.enabled && <span className='shrink-0 text-[10px] text-muted-foreground'>Disabled</span>}
				<Badge variant={fullyGranted ? 'secondary' : 'outline'} className='shrink-0'>
					{fullyGranted ? 'Full server' : 'Partial'}
				</Badge>
				<Badge variant='secondary' className='h-5 shrink-0 px-1.5 text-[10px] font-normal'>
					{server.tools.length === 0
						? 'No tools discovered'
						: `${grantedTools.length}/${server.tools.length} tools`}
				</Badge>
			</div>
			{open && (
				<ul id={panelId} className='pb-2'>
					{grantedTools.map((tool) => (
						<li
							key={tool.name}
							className='flex h-7 items-center gap-2 pl-11 pr-3 text-xs'
							title={tool.description}
						>
							<span className='min-w-0 flex-1 truncate font-mono'>{tool.name}</span>
							{server.enabled && !tool.enabled && (
								<span className='shrink-0 text-[10px] text-muted-foreground'>Disabled</span>
							)}
						</li>
					))}
				</ul>
			)}
		</li>
	);
}
