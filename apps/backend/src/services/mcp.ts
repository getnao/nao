import type { McpServerConfig, McpServerStatus, McpToolSummary, McpTransport } from '@nao/shared';
import { debounce } from '@nao/shared';
import { mcpJsonSchema } from '@nao/shared';
import { existsSync, watch } from 'fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { createRuntime, type Runtime, ServerDefinition } from 'mcporter';
import { join } from 'path';

import { getDisabledMcpServers, getDisabledMcpTools, retrieveProjectById } from '../queries/project.queries';
import { logger } from '../utils/logger';
import { replaceEnvVars } from '../utils/utils';
import { buildMcpOpenApiDocument, extractToolsFromOpenApi, type McpToolDefinition } from './mcp-openapi';

const HTTP_TRANSPORTS = ['streamable-http', 'sse', 'http'];
const MCPS_DIR = ['agent', 'mcps'];
const GITIGNORE_CONTENT = '# nao: discovered MCP tool specs (generated at runtime)\n*/\n';

type DisabledSets = { servers: Set<string>; tools: Set<string> };

/**
 * Manages MCP servers declared in `agent/mcps/mcp.json`. Instead of loading every tool
 * into the agent context window, it discovers each server's tools and writes the enabled
 * ones as per-tool OpenAPI specs on disk (`agent/mcps/<server>/<tool>.json`). The agent
 * explores those specs with the file tools and invokes a tool on demand through the
 * `mcp_call` tool. The generated specs are runtime artifacts and are gitignored.
 */
export class McpService {
	private _projectId: string | null = null;
	private _projectPath = '';
	private _mcpJsonFilePath = '';
	private _mcpServers: Record<string, McpServerConfig> = {};
	private _runtime: Runtime | null = null;
	private _registered = new Set<string>();
	/** Full tool list per server from the last successful discovery this session. */
	private _discovered: Record<string, McpToolDefinition[]> = {};
	private _failedConnections: Record<string, string> = {};
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReload: () => void;
	private _initPromise: Promise<void> | null = null;

	constructor() {
		this._debouncedReload = debounce(() => {
			void this._reloadAndDiscover();
		}, 2000);
	}

	public async initializeMcpState(projectId: string): Promise<void> {
		if (this._initPromise && this._projectId === projectId) {
			return this._initPromise;
		}

		if (this._fileWatcher) {
			this._fileWatcher.close();
			this._fileWatcher = null;
		}

		this._projectId = projectId;
		this._initPromise = this._initialize(projectId).catch((err) => {
			this._initPromise = null;
			throw err;
		});
		return this._initPromise;
	}

	public getConfiguredServerNames(): string[] {
		return Object.keys(this._mcpServers);
	}

	/** Configured servers the agent is currently allowed to call (not disabled by admin). */
	public async getEnabledServers(projectId: string): Promise<string[]> {
		await this.initializeMcpState(projectId);
		const disabled = new Set(await getDisabledMcpServers(projectId));
		return this.getConfiguredServerNames().filter((name) => !disabled.has(name));
	}

	public async getServersStatus(projectId: string): Promise<McpServerStatus[]> {
		await this.initializeMcpState(projectId);
		const disabled = await this._loadDisabled();

		return Promise.all(
			Object.entries(this._mcpServers).map(async ([name, config]) => {
				const tools = await this._serverToolSummaries(name, disabled);
				const discovered = this._discovered[name] !== undefined || existsSync(this._serverDir(name));
				return {
					name,
					transport: this._transportOf(config),
					enabled: !disabled.servers.has(name),
					discovered,
					connectionOk: this._discovered[name] !== undefined && !this._failedConnections[name],
					toolCount: tools.length,
					enabledToolCount: tools.filter((tool) => tool.enabled).length,
					tools,
					specPath: this._virtualServerDir(name),
					error: this._failedConnections[name],
				};
			}),
		);
	}

	/** (Re)connects every configured server and rewrites the enabled per-tool specs. */
	public async discover(projectId?: string): Promise<void> {
		if (projectId) {
			await this.initializeMcpState(projectId);
		}
		await this._discoverAll();
	}

	/** Rewrites the on-disk specs to reflect the current enablement (after an admin toggle). */
	public async applyEnablement(projectId: string, serverName?: string): Promise<void> {
		await this.initializeMcpState(projectId);
		const disabled = await this._loadDisabled();
		const servers = serverName ? [serverName] : Object.keys(this._mcpServers);
		for (const name of servers) {
			if (this._discovered[name] === undefined) {
				await this._discoverServer(name, disabled);
			} else {
				await this._writeEnabledSpecs(name, disabled);
			}
		}
	}

	public async callTool(opts: {
		projectId: string;
		server: string;
		tool: string;
		args: Record<string, unknown>;
		allowedServers?: string[] | null;
	}): Promise<unknown> {
		const { projectId, server, tool, args, allowedServers } = opts;
		await this.initializeMcpState(projectId);

		if (!this._mcpServers[server]) {
			const configured = this.getConfiguredServerNames().join(', ') || '(none)';
			throw new Error(`MCP server "${server}" is not configured. Configured servers: ${configured}.`);
		}
		if (allowedServers && !allowedServers.includes(server)) {
			throw new Error(`MCP server "${server}" is not available in this context.`);
		}
		const disabled = await this._loadDisabled();
		if (disabled.servers.has(server)) {
			throw new Error(`MCP server "${server}" is disabled by the project admin.`);
		}
		if (disabled.tools.has(this._toolKey(server, tool))) {
			throw new Error(`MCP tool "${tool}" on server "${server}" is disabled by the project admin.`);
		}

		await this._ensureRegistered(server);
		if (!this._runtime) {
			throw new Error('MCP runtime not initialized');
		}

		try {
			return await this._runtime.callTool(server, tool, { args });
		} catch (error) {
			logger.error(`MCP tool call failed: ${server}/${tool}`, {
				source: 'tool',
				projectId,
				context: { server, tool, error: String(error) },
			});
			throw error;
		}
	}

	private async _initialize(projectId: string): Promise<void> {
		const project = await retrieveProjectById(projectId);
		this._projectPath = project.path || '';
		this._mcpJsonFilePath = join(this._projectPath, ...MCPS_DIR, 'mcp.json');

		this._resetRuntime();
		await this._loadConfig();
		await this._ensureSpecs();
		this._setupFileWatcher();
	}

	private async _reloadAndDiscover(): Promise<void> {
		try {
			this._resetRuntime();
			await this._loadConfig();
			await this._discoverAll();
		} catch (error) {
			logger.error(`MCP reload failed: ${String(error)}`, {
				source: 'tool',
				projectId: this._projectId ?? undefined,
			});
		}
	}

	private _resetRuntime(): void {
		this._runtime = null;
		this._registered = new Set();
	}

	private async _loadConfig(): Promise<void> {
		if (!this._mcpJsonFilePath || !existsSync(this._mcpJsonFilePath)) {
			this._mcpServers = {};
			return;
		}

		try {
			const fileContent = await readFile(this._mcpJsonFilePath, 'utf8');
			const resolved = replaceEnvVars(fileContent);
			const parsed = mcpJsonSchema.parse(JSON.parse(resolved));
			this._mcpServers = parsed.mcpServers;
		} catch (error) {
			logger.error(`MCP config parse failed: ${this._mcpJsonFilePath}`, {
				source: 'tool',
				projectId: this._projectId ?? undefined,
				context: { error: String(error) },
			});
			this._mcpServers = {};
		}
	}

	/** Discovers servers that don't yet have a specs folder on disk, leaving existing ones intact. */
	private async _ensureSpecs(): Promise<void> {
		await this._ensureGitignore();
		const missing = Object.keys(this._mcpServers).filter((name) => !existsSync(this._serverDir(name)));
		if (missing.length === 0) {
			return;
		}
		const disabled = await this._loadDisabled();
		await Promise.all(missing.map((name) => this._discoverServer(name, disabled)));
	}

	private async _discoverAll(): Promise<void> {
		this._failedConnections = {};
		await this._ensureGitignore();
		const disabled = await this._loadDisabled();
		await Promise.all(Object.keys(this._mcpServers).map((name) => this._discoverServer(name, disabled)));
	}

	private async _discoverServer(name: string, disabled: DisabledSets): Promise<void> {
		const config = this._mcpServers[name];
		if (!config) {
			return;
		}

		try {
			await this._ensureRegistered(name);
			if (!this._runtime) {
				throw new Error('MCP runtime not initialized');
			}

			const tools = await this._runtime.listTools(name, { includeSchema: true });
			this._discovered[name] = tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));
			delete this._failedConnections[name];
		} catch (error) {
			const message = (error as Error).message;
			this._failedConnections[name] = message;
			this._discovered[name] = this._discovered[name] ?? [];
			logger.error(`MCP discovery failed: ${name}`, {
				source: 'tool',
				projectId: this._projectId ?? undefined,
				context: { server: name, error: message },
			});
		}

		await this._writeEnabledSpecs(name, disabled);
	}

	/** Writes one OpenAPI spec file per enabled tool, removing any stale spec files. */
	private async _writeEnabledSpecs(name: string, disabled: DisabledSets): Promise<void> {
		const config = this._mcpServers[name];
		if (!config) {
			return;
		}

		const dir = this._serverDir(name);
		await mkdir(dir, { recursive: true });
		await this._clearSpecFiles(dir);

		if (disabled.servers.has(name)) {
			return;
		}

		const transport = this._transportOf(config);
		const tools = this._discovered[name] ?? [];
		await Promise.all(
			tools
				.filter((tool) => !disabled.tools.has(this._toolKey(name, tool.name)))
				.map((tool) => {
					const doc = buildMcpOpenApiDocument({ serverName: name, transport, tools: [tool] });
					return writeFile(this._toolFilePath(name, tool.name), JSON.stringify(doc, null, 2), 'utf8');
				}),
		);
	}

	private async _clearSpecFiles(dir: string): Promise<void> {
		try {
			const files = await readdir(dir);
			await Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => unlink(join(dir, file))));
		} catch {
			// Nothing to clear
		}
	}

	private async _serverToolSummaries(name: string, disabled: DisabledSets): Promise<McpToolSummary[]> {
		const discovered = this._discovered[name];
		if (discovered) {
			return discovered.map((tool) => ({
				name: tool.name,
				description: tool.description,
				enabled: !disabled.servers.has(name) && !disabled.tools.has(this._toolKey(name, tool.name)),
			}));
		}

		const fromDisk = await this._readSpecTools(name);
		return (fromDisk ?? []).map((tool) => ({ ...tool, enabled: true }));
	}

	private async _readSpecTools(name: string): Promise<{ name: string; description?: string }[] | null> {
		const dir = this._serverDir(name);
		if (!existsSync(dir)) {
			return null;
		}
		try {
			const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
			const tools: { name: string; description?: string }[] = [];
			for (const file of files) {
				const content = await readFile(join(dir, file), 'utf8');
				tools.push(...extractToolsFromOpenApi(JSON.parse(content)));
			}
			return tools;
		} catch {
			return null;
		}
	}

	private async _loadDisabled(): Promise<DisabledSets> {
		if (!this._projectId) {
			return { servers: new Set(), tools: new Set() };
		}
		const [servers, tools] = await Promise.all([
			getDisabledMcpServers(this._projectId),
			getDisabledMcpTools(this._projectId),
		]);
		return { servers: new Set(servers), tools: new Set(tools) };
	}

	private async _ensureRegistered(name: string): Promise<void> {
		if (!this._runtime) {
			this._runtime = await createRuntime();
		}
		if (this._registered.has(name)) {
			return;
		}
		const config = this._mcpServers[name];
		if (!config) {
			throw new Error(`MCP server "${name}" is not configured.`);
		}
		this._runtime.registerDefinition(this._toServerDefinition(name, config), { overwrite: true });
		this._registered.add(name);
	}

	private _toServerDefinition(name: string, config: McpServerConfig): ServerDefinition {
		if (this._transportOf(config) === 'http') {
			return {
				name,
				auth: 'oauth',
				command: {
					kind: 'http',
					url: config.url!,
					headers: config.headers,
				},
				source: { kind: 'local', path: '<adhoc>' },
			};
		}

		return {
			name,
			command: {
				kind: 'stdio',
				command: config.command || '',
				args: config.args || [],
				cwd: process.cwd(),
			},
			env: config.env,
		};
	}

	private _transportOf(config: McpServerConfig): McpTransport {
		const isHttp =
			config.type === 'http' || (config.transport !== undefined && HTTP_TRANSPORTS.includes(config.transport));
		return isHttp ? 'http' : 'stdio';
	}

	private _toolKey(server: string, tool: string): string {
		return `${server}/${tool}`;
	}

	private _serverDir(name: string): string {
		return join(this._projectPath, ...MCPS_DIR, name);
	}

	private _toolFilePath(name: string, tool: string): string {
		return join(this._serverDir(name), `${tool}.json`);
	}

	private _virtualServerDir(name: string): string {
		return `/${[...MCPS_DIR, name].join('/')}`;
	}

	private async _ensureGitignore(): Promise<void> {
		const dir = join(this._projectPath, ...MCPS_DIR);
		if (!existsSync(dir)) {
			return;
		}
		const gitignorePath = join(dir, '.gitignore');
		if (existsSync(gitignorePath)) {
			return;
		}
		try {
			await writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
		} catch {
			// Best-effort
		}
	}

	private _setupFileWatcher(): void {
		if (!this._mcpJsonFilePath || !existsSync(this._mcpJsonFilePath)) {
			return;
		}

		try {
			this._fileWatcher = watch(this._mcpJsonFilePath, (eventType) => {
				if (eventType === 'change') {
					this._debouncedReload();
				}
			});
		} catch (error) {
			logger.error(`MCP file watcher setup failed: ${String(error)}`, {
				source: 'tool',
				projectId: this._projectId ?? undefined,
				context: { path: this._mcpJsonFilePath, error: String(error) },
			});
		}
	}
}

export const mcpService = new McpService();
