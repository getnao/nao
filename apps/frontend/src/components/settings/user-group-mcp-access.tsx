import { isMcpServerFullyGranted, isMcpServerGranted, isMcpToolGranted, normalizeMcpAccess } from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import type { McpAccess, McpServerStatus } from '@nao/shared';

import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { UserGroupContextModeSelector } from '@/components/settings/user-group-context-mode-selector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface UserGroupMcpAccessProps {
	mcpAccess: McpAccess;
	isLicensed: boolean;
	onMcpAccessChange: (access: McpAccess) => void;
}

const ROW_CLASS = 'flex h-8 w-full items-center gap-1.5 px-2 text-left text-sm transition-colors hover:bg-muted/50';
const SELECTED_ROW_CLASS = 'bg-primary/10 text-primary hover:bg-primary/15';
const PARTIAL_CHECKBOX_CLASS =
	'data-[state=indeterminate]:bg-primary/15 data-[state=indeterminate]:text-primary/70 data-[state=indeterminate]:shadow-none';

export function UserGroupMcpAccess({ mcpAccess, isLicensed, onMcpAccessChange }: UserGroupMcpAccessProps) {
	const servers = useQuery(trpc.mcp.getServers.queryOptions());
	const configuredServers = servers.data ?? [];
	const unconfiguredServers = getUnconfiguredMcpGrantServers(mcpAccess, configuredServers);
	const grantedServerCount = configuredServers.filter((server) => isMcpServerGranted(mcpAccess, server.name)).length;
	const readOnly = !isLicensed || mcpAccess.mode === 'all';

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<p className='text-sm text-muted-foreground'>
					Choose which MCP servers and tools this group can use in chats, Slack, and automations. Access from
					groups is combined.
				</p>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			<UserGroupContextModeSelector
				mode={mcpAccess.mode}
				everythingDescription='All current and future MCP servers and tools.'
				specificDescription={isLicensed ? 'Choose servers and tools.' : 'Requires an Enterprise license.'}
				onEverything={() => onMcpAccessChange({ mode: 'all' })}
				onSpecific={() => {
					if (isLicensed && mcpAccess.mode === 'all') {
						onMcpAccessChange({ mode: 'restricted', grants: [] });
					}
				}}
			/>
			<Badge variant='secondary' className='w-fit whitespace-nowrap'>
				{mcpAccess.mode === 'all'
					? 'All servers'
					: `${grantedServerCount} of ${configuredServers.length} ${configuredServers.length === 1 ? 'server' : 'servers'}`}
			</Badge>
			<div className='max-h-80 overflow-auto rounded-lg border'>
				<ul>
					{servers.isLoading ? (
						<StatusRow status='Loading MCP servers...' />
					) : servers.isError ? (
						<StatusRow status='Failed to load MCP servers' onRetry={() => void servers.refetch()} />
					) : configuredServers.length === 0 && unconfiguredServers.length === 0 ? (
						<StatusRow status='No MCP servers configured in agent/mcps/mcp.json' />
					) : (
						<>
							{configuredServers.map((server) => (
								<McpServerRow
									key={server.name}
									server={server}
									access={mcpAccess}
									readOnly={readOnly}
									onChange={onMcpAccessChange}
								/>
							))}
							{unconfiguredServers.map((serverName) => (
								<UnconfiguredServerRow
									key={serverName}
									serverName={serverName}
									readOnly={readOnly}
									onRemove={() =>
										onMcpAccessChange(toggleMcpServerGrant(mcpAccess, serverName, false))
									}
								/>
							))}
						</>
					)}
				</ul>
			</div>
		</div>
	);
}

function McpServerRow({
	server,
	access,
	readOnly,
	onChange,
}: {
	server: McpServerStatus;
	access: McpAccess;
	readOnly: boolean;
	onChange: (access: McpAccess) => void;
}) {
	const [open, setOpen] = useState(false);
	const inherited = access.mode === 'all';
	const fullyGranted = isMcpServerFullyGranted(access, server.name);
	const partial = !fullyGranted && isMcpServerGranted(access, server.name);
	const toolNames = server.tools.map((tool) => tool.name);
	const grantedToolCount = toolNames.filter((tool) => isMcpToolGranted(access, server.name, tool)).length;
	const panelId = useId();

	return (
		<li>
			<div className={cn(ROW_CLASS, fullyGranted && SELECTED_ROW_CLASS)}>
				<button
					type='button'
					className='flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:invisible'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${server.name} tools`}
					aria-expanded={open}
					aria-controls={panelId}
					disabled={server.tools.length === 0}
					onClick={() => setOpen(!open)}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					checked={partial ? 'indeterminate' : fullyGranted}
					aria-label={`${server.name} server access`}
					disabled={readOnly}
					className={cn('disabled:cursor-default', PARTIAL_CHECKBOX_CLASS)}
					onCheckedChange={(checked) => onChange(toggleMcpServerGrant(access, server.name, checked === true))}
				/>
				<span className='min-w-0 flex-1 truncate font-medium' title={server.name}>
					{server.name}
				</span>
				{!server.enabled && <span className='shrink-0 text-[10px] text-muted-foreground'>Disabled</span>}
				{inherited && <span className='shrink-0 text-[10px] text-primary/80'>Inherited</span>}
				{partial && <span className='shrink-0 text-[10px] text-muted-foreground'>Partial</span>}
				<Badge variant='secondary' className='h-5 shrink-0 px-1.5 text-[10px] font-normal'>
					{server.tools.length === 0
						? 'No tools discovered'
						: `${grantedToolCount}/${server.tools.length} tools`}
				</Badge>
			</div>
			{open && (
				<ul id={panelId}>
					{server.tools.map((tool) => (
						<McpToolRow
							key={tool.name}
							serverName={server.name}
							toolName={tool.name}
							description={tool.description}
							disabledInProject={server.enabled && !tool.enabled}
							access={access}
							readOnly={readOnly}
							onSelectedChange={(selected) =>
								onChange(toggleMcpToolGrant(access, server.name, tool.name, selected, toolNames))
							}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function McpToolRow({
	serverName,
	toolName,
	description,
	disabledInProject,
	access,
	readOnly,
	onSelectedChange,
}: {
	serverName: string;
	toolName: string;
	description?: string;
	disabledInProject: boolean;
	access: McpAccess;
	readOnly: boolean;
	onSelectedChange: (selected: boolean) => void;
}) {
	const selected = isMcpToolGranted(access, serverName, toolName);

	return (
		<li>
			<div className={cn(ROW_CLASS, 'pl-9', selected && SELECTED_ROW_CLASS)} title={description}>
				<Checkbox
					checked={selected}
					aria-label={`${toolName} tool access`}
					disabled={readOnly}
					className='disabled:cursor-default'
					onCheckedChange={(checked) => onSelectedChange(checked === true)}
				/>
				<span className='min-w-0 flex-1 truncate font-mono text-xs'>{toolName}</span>
				{disabledInProject && <span className='shrink-0 text-[10px] text-muted-foreground'>Disabled</span>}
			</div>
		</li>
	);
}

function UnconfiguredServerRow({
	serverName,
	readOnly,
	onRemove,
}: {
	serverName: string;
	readOnly: boolean;
	onRemove: () => void;
}) {
	return (
		<li className={cn(ROW_CLASS, 'pl-7')}>
			<Checkbox
				checked
				aria-label={`${serverName} server access`}
				disabled={readOnly}
				className='disabled:cursor-default'
				onCheckedChange={onRemove}
			/>
			<span className='min-w-0 flex-1 truncate font-medium text-muted-foreground' title={serverName}>
				{serverName}
			</span>
			<span className='shrink-0 text-[10px] text-muted-foreground'>Not configured</span>
		</li>
	);
}

function StatusRow({ status, onRetry }: { status: string; onRetry?: () => void }) {
	return (
		<li className='flex h-8 items-center gap-2 px-3 text-sm text-muted-foreground'>
			<span className={cn('min-w-0 flex-1 truncate text-xs', onRetry && 'text-destructive')}>{status}</span>
			{onRetry && (
				<Button type='button' size='sm' variant='ghost' className='h-6 px-2 text-xs' onClick={onRetry}>
					Retry
				</Button>
			)}
		</li>
	);
}

export function toggleMcpServerGrant(access: McpAccess, server: string, selected: boolean): McpAccess {
	if (access.mode === 'all') {
		return access;
	}
	const otherGrants = access.grants.filter((grant) => grant.server !== server);
	return normalizeMcpAccess({
		mode: 'restricted',
		grants: selected ? [...otherGrants, { kind: 'server', server }] : otherGrants,
	});
}

/** Unchecking one tool of a whole-server grant keeps the other known tools, so future tools are no longer granted. */
export function toggleMcpToolGrant(
	access: McpAccess,
	server: string,
	tool: string,
	selected: boolean,
	serverTools: string[],
): McpAccess {
	if (access.mode === 'all') {
		return access;
	}
	if (selected) {
		return normalizeMcpAccess({ mode: 'restricted', grants: [...access.grants, { kind: 'tool', server, tool }] });
	}
	const grantedTools = serverTools.filter(
		(candidate) => candidate !== tool && isMcpToolGranted(access, server, candidate),
	);
	return normalizeMcpAccess({
		mode: 'restricted',
		grants: [
			...access.grants.filter((grant) => grant.server !== server),
			...grantedTools.map((grantedTool) => ({ kind: 'tool' as const, server, tool: grantedTool })),
		],
	});
}

export function getUnconfiguredMcpGrantServers(access: McpAccess, servers: Pick<McpServerStatus, 'name'>[]): string[] {
	if (access.mode === 'all') {
		return [];
	}
	const configured = new Set(servers.map((server) => server.name));
	return [...new Set(access.grants.map((grant) => grant.server))].filter((server) => !configured.has(server));
}
