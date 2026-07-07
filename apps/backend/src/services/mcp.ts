import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpServerStatus, McpToolSummary, McpTransport } from '@nao/shared';
import { debounce } from '@nao/shared';
import { mcpJsonSchema } from '@nao/shared';
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { existsSync, watch } from 'fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { createRuntime, type Runtime, ServerDefinition } from 'mcporter';
import { isAbsolute, join, relative, resolve, sep } from 'path';

import { deleteMcpUserToken, getMcpOAuthClient, hasMcpUserToken } from '../queries/mcp-oauth.queries';
import { getDisabledMcpServers, getDisabledMcpTools, retrieveProjectById } from '../queries/project.queries';
import { logger } from '../utils/logger';
import { replaceEnvVars } from '../utils/utils';
import { getValidAccessToken, isOAuthServer, isUnauthorizedError, McpAuthRequiredError } from './mcp-oauth';
import { buildMcpOpenApiDocument, extractToolsFromOpenApi, type McpToolDefinition } from './mcp-openapi';

const HTTP_TRANSPORTS = ['streamable-http', 'sse', 'http'];
const MCPS_DIR = ['agent', 'mcps'];
const GITIGNORE_CONTENT = '# nao: discovered MCP tool specs (generated at runtime)\n*/\n';

type DisabledSets = { servers: Set<string>; tools: Set<string> };

/** Thrown when `mcp_call` arguments do not match the target tool's discovered input schema. */
export class McpArgsValidationError extends Error {
	constructor(
		public readonly server: string,
		public readonly tool: string,
		public readonly issues: string[],
	) {
		super(`Invalid arguments for MCP tool "${tool}" on server "${server}": ${issues.join('; ')}`);
		this.name = 'McpArgsValidationError';
	}
}

/** Turns an Ajv validation error into a short, model-readable sentence. */
function formatSchemaError(error: ErrorObject): string {
	const path = error.instancePath ? error.instancePath.replace(/^\//, '').replaceAll('/', '.') : '';
	const where = path ? `\`${path}\`` : 'arguments';
	const extra =
		error.keyword === 'additionalProperties' && 'additionalProperty' in error.params
			? ` (\`${error.params.additionalProperty}\`)`
			: '';
	return `${where} ${error.message ?? 'is invalid'}${extra}`;
}

function isWithinDirectory(base: string, target: string): boolean {
	const relativePath = relative(base, target);
	return (
		relativePath === '' ||
		(!!relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

/**
 * Manages MCP servers declared in `agent/mcps/mcp.json`. Instead of loading every tool
 * into the agent context window, it discovers each server's tools and writes the enabled
 * ones as per-tool OpenAPI specs on disk (`agent/mcps/<server>/<tool>.json`). The agent
 * explores those specs with the file tools and invokes a tool on demand through the
 * `mcp_call` tool. OAuth-protected servers are scoped per user: discovery uses the admin's
 * token and each runtime call uses the calling user's token.
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
	/** Cached per-server flag for whether the server is OAuth-protected. */
	private _oauth: Record<string, boolean> = {};
	/** Compiled argument validators keyed by `server/tool`, rebuilt when a server is rediscovered. */
	private _validators = new Map<string, ValidateFunction>();
	private _ajv: Ajv2020 | null = null;
	private _failedConnections: Record<string, string> = {};
	/** Error from the last attempt to read/parse `agent/mcps/mcp.json`, if any. */
	private _configError: string | null = null;
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

	public async getConfigError(projectId: string): Promise<string | null> {
		await this.initializeMcpState(projectId);
		return this._configError;
	}

	/** Configured servers the agent is currently allowed to call (not disabled by admin). */
	public async getEnabledServers(projectId: string): Promise<string[]> {
		await this.initializeMcpState(projectId);
		const disabled = new Set(await getDisabledMcpServers(projectId));
		return this.getConfiguredServerNames().filter((name) => !disabled.has(name));
	}

	/** The configured URL for an HTTP server, or null if not an HTTP server. */
	public async getServerUrl(projectId: string, server: string): Promise<string | null> {
		await this.initializeMcpState(projectId);
		const config = this._mcpServers[server];
		if (!config || this._transportOf(config) !== 'http' || !config.url) {
			return null;
		}
		return config.url.toString();
	}

	public async getServersStatus(projectId: string, userId?: string): Promise<McpServerStatus[]> {
		await this.initializeMcpState(projectId);
		const disabled = await this._loadDisabled();

		return Promise.all(
			Object.entries(this._mcpServers).map(async ([name, config]) => {
				const tools = await this._serverToolSummaries(name, disabled);
				const discovered = this._discovered[name] !== undefined || existsSync(this._serverDir(name));
				const oauth = await this._ensureOAuthFlag(name, config);
				const oauthConnected = oauth && userId ? await hasMcpUserToken(userId, projectId, name) : false;
				return {
					name,
					transport: this._transportOf(config),
					url: this._serverOrigin(config),
					enabled: !disabled.servers.has(name),
					discovered,
					connectionOk: this._discovered[name] !== undefined && !this._failedConnections[name],
					oauth,
					oauthConnected,
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

	/** Re-discovers a single server (used after an admin connects an OAuth server). */
	public async discoverServer(projectId: string, server: string): Promise<void> {
		await this.initializeMcpState(projectId);
		const disabled = await this._loadDisabled();
		await this._discoverServer(server, disabled);
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
		userId: string;
		server: string;
		tool: string;
		args: Record<string, unknown>;
		allowedServers?: string[] | null;
	}): Promise<unknown> {
		const { projectId, userId, server, tool, args, allowedServers } = opts;
		await this.initializeMcpState(projectId);

		const config = this._mcpServers[server];
		if (!config) {
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

		await this._validateArgs(server, tool, args);

		try {
			if (await this._ensureOAuthFlag(server, config)) {
				return await this._callToolOAuth({ projectId, userId, server, tool, args, config });
			}
			return await this._callToolMcporter(server, tool, args);
		} catch (error) {
			if (error instanceof McpAuthRequiredError) {
				throw error;
			}
			logger.error(`MCP tool call failed: ${server}/${tool}`, {
				source: 'tool',
				projectId,
				context: { server, tool, error: String(error) },
			});
			throw error;
		}
	}

	private async _callToolMcporter(server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
		await this._ensureRegistered(server);
		if (!this._runtime) {
			throw new Error('MCP runtime not initialized');
		}
		return this._runtime.callTool(server, tool, { args });
	}

	private async _callToolOAuth(opts: {
		projectId: string;
		userId: string;
		server: string;
		tool: string;
		args: Record<string, unknown>;
		config: McpServerConfig;
	}): Promise<unknown> {
		const { projectId, userId, server, tool, args, config } = opts;
		const url = config.url!.toString();
		const token = await getValidAccessToken({ userId, projectId, server, serverUrl: url });
		if (!token) {
			throw new McpAuthRequiredError(server);
		}

		try {
			return await this._withHttpClient(config, this._httpHeaders(config, token), (client) =>
				client.callTool({ name: tool, arguments: args }),
			);
		} catch (error) {
			if (isUnauthorizedError(error)) {
				await deleteMcpUserToken(userId, projectId, server);
				throw new McpAuthRequiredError(server);
			}
			throw error;
		}
	}

	/**
	 * Validates the call arguments against the tool's discovered JSON Schema before dispatching.
	 * When no schema is known (e.g. a server that failed discovery) the call proceeds unvalidated
	 * so the remote server stays the ultimate authority.
	 */
	private async _validateArgs(server: string, tool: string, args: Record<string, unknown>): Promise<void> {
		const schema = await this._toolInputSchema(server, tool);
		if (!schema) {
			return;
		}
		const validate = this._getValidator(server, tool, schema);
		if (!validate) {
			return;
		}
		try {
			if (await validate(args)) {
				return;
			}
		} catch (error) {
			const issues = ((error as { errors?: ErrorObject[] }).errors ?? []).map(formatSchemaError);
			if (issues.length) {
				throw new McpArgsValidationError(server, tool, issues);
			}
			throw error;
		}
		if (validate.errors?.length === 0) {
			return;
		}
		const issues = (validate.errors ?? []).map(formatSchemaError);
		throw new McpArgsValidationError(
			server,
			tool,
			issues.length ? issues : ['arguments do not match the tool schema'],
		);
	}

	/** Resolves a tool's input schema from this session's discovery, falling back to the on-disk spec. */
	private async _toolInputSchema(server: string, tool: string): Promise<Record<string, unknown> | null> {
		const discovered = this._discovered[server]?.find((entry) => entry.name === tool);
		if (discovered?.inputSchema && typeof discovered.inputSchema === 'object') {
			return discovered.inputSchema as Record<string, unknown>;
		}
		return this._readToolSchemaFromDisk(server, tool);
	}

	private async _readToolSchemaFromDisk(server: string, tool: string): Promise<Record<string, unknown> | null> {
		const file = this._toolFilePath(server, tool);
		if (!existsSync(file)) {
			return null;
		}
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			const schema = doc?.paths?.[`/tools/${tool}`]?.post?.requestBody?.content?.['application/json']?.schema;
			return schema && typeof schema === 'object' ? (schema as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}

	/** Compiles and caches a validator for a tool schema, or null if the schema cannot be compiled. */
	private _getValidator(server: string, tool: string, schema: Record<string, unknown>): ValidateFunction | null {
		const key = this._toolKey(server, tool);
		const cached = this._validators.get(key);
		if (cached) {
			return cached;
		}
		try {
			const { $id: _id, ...schemaWithoutId } = schema;
			const validate = this._getAjv().compile(schemaWithoutId);
			this._validators.set(key, validate);
			return validate;
		} catch (error) {
			logger.warn(`MCP tool schema not validatable: ${server}/${tool}`, {
				source: 'tool',
				projectId: this._projectId ?? undefined,
				context: { server, tool, error: String(error) },
			});
			return null;
		}
	}

	private _getAjv(): Ajv2020 {
		if (!this._ajv) {
			this._ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, validateFormats: false });
		}
		return this._ajv;
	}

	private _clearValidators(server: string): void {
		const prefix = `${server}/`;
		for (const key of this._validators.keys()) {
			if (key.startsWith(prefix)) {
				this._validators.delete(key);
			}
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
		this._oauth = {};
		this._validators.clear();
	}

	private async _loadConfig(): Promise<void> {
		if (!this._mcpJsonFilePath || !existsSync(this._mcpJsonFilePath)) {
			this._mcpServers = {};
			this._configError = null;
			return;
		}

		try {
			const fileContent = await readFile(this._mcpJsonFilePath, 'utf8');
			const resolved = replaceEnvVars(fileContent);
			const parsed = mcpJsonSchema.parse(JSON.parse(resolved));
			this._mcpServers = parsed.mcpServers;
			this._configError = null;
		} catch (error) {
			this._configError = this._formatConfigError(error);
			logger.error(`MCP config parse failed: ${this._mcpJsonFilePath}`, {
				source: 'tool',
				projectId: this._projectId ?? undefined,
				context: { error: String(error) },
			});
			this._mcpServers = {};
		}
	}

	private _formatConfigError(error: unknown): string {
		if (error instanceof SyntaxError) {
			return `Invalid JSON in agent/mcps/mcp.json: ${error.message}`;
		}
		if (error instanceof Error) {
			return `Invalid agent/mcps/mcp.json: ${error.message}`;
		}
		return `Invalid agent/mcps/mcp.json: ${String(error)}`;
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

		this._clearValidators(name);

		try {
			this._discovered[name] = await this._listTools(name, config);
			delete this._failedConnections[name];
		} catch (error) {
			if (error instanceof McpAuthRequiredError) {
				this._failedConnections[name] = 'OAuth connection required — an admin must connect this server.';
			} else {
				if (isUnauthorizedError(error) && !this._hasStaticAuth(config)) {
					this._oauth[name] = true;
				}
				this._failedConnections[name] = (error as Error).message;
				logger.error(`MCP discovery failed: ${name}`, {
					source: 'tool',
					projectId: this._projectId ?? undefined,
					context: { server: name, error: (error as Error).message },
				});
			}
			this._discovered[name] = this._discovered[name] ?? [];
		}

		await this._writeEnabledSpecs(name, disabled);
	}

	/** Lists the tools of a server, using the admin's OAuth token for OAuth-protected servers. */
	private async _listTools(name: string, config: McpServerConfig): Promise<McpToolDefinition[]> {
		if (await this._ensureOAuthFlag(name, config)) {
			const url = config.url!.toString();
			const token = await this._discoveryToken(name, url);
			if (!token) {
				throw new McpAuthRequiredError(name);
			}
			return this._withHttpClient(config, this._httpHeaders(config, token), async (client) => {
				const result = await client.listTools();
				return result.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				}));
			});
		}

		await this._ensureRegistered(name);
		if (!this._runtime) {
			throw new Error('MCP runtime not initialized');
		}
		const tools = await this._runtime.listTools(name, { includeSchema: true });
		return tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
	}

	private async _discoveryToken(server: string, serverUrl: string): Promise<string | null> {
		if (!this._projectId) {
			return null;
		}
		const client = await getMcpOAuthClient(this._projectId, server);
		if (!client?.discoveryUserId) {
			return null;
		}
		return getValidAccessToken({
			userId: client.discoveryUserId,
			projectId: this._projectId,
			server,
			serverUrl,
		});
	}

	/**
	 * Resolves and caches whether a server needs per-user OAuth. A server that already carries a
	 * static credential in `mcp.json` (e.g. an `Authorization` or `x-api-key` header) is treated as
	 * pre-authenticated for everyone — no per-user token is required even if it advertises OAuth.
	 */
	private async _ensureOAuthFlag(name: string, config: McpServerConfig): Promise<boolean> {
		if (this._oauth[name] !== undefined) {
			return this._oauth[name];
		}
		if (this._transportOf(config) !== 'http' || !config.url || this._hasStaticAuth(config)) {
			this._oauth[name] = false;
			return false;
		}
		this._oauth[name] = await isOAuthServer(config.url.toString());
		return this._oauth[name];
	}

	/** Whether the server config supplies its own credential, removing the need for per-user OAuth. */
	private _hasStaticAuth(config: McpServerConfig): boolean {
		return Object.keys(config.headers ?? {}).some((key) => {
			const name = key.toLowerCase();
			return name === 'authorization' || name === 'x-api-key' || name === 'api-key' || name.includes('token');
		});
	}

	private async _withHttpClient<T>(
		config: McpServerConfig,
		headers: Record<string, string>,
		fn: (client: Client) => Promise<T>,
	): Promise<T> {
		const url = new URL(config.url!.toString());
		const transport =
			config.transport === 'sse'
				? new SSEClientTransport(url, { requestInit: { headers } })
				: new StreamableHTTPClientTransport(url, { requestInit: { headers } });
		const client = new Client({ name: 'nao', version: '1.0.0' }, { capabilities: {} });
		await client.connect(transport);
		try {
			return await fn(client);
		} finally {
			await client.close().catch(() => undefined);
		}
	}

	private _httpHeaders(config: McpServerConfig, token: string): Record<string, string> {
		return { ...(config.headers ?? {}), Authorization: `Bearer ${token}` };
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

	private _serverOrigin(config: McpServerConfig): string | undefined {
		if (this._transportOf(config) !== 'http' || !config.url) {
			return undefined;
		}
		return new URL(config.url.toString()).origin;
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
		return this._containedPath(this._mcpsDir(), name);
	}

	private _toolFilePath(name: string, tool: string): string {
		return this._containedPath(this._serverDir(name), `${this._toolSpecFileName(tool)}.json`);
	}

	private _virtualServerDir(name: string): string {
		return `/${[...MCPS_DIR, name].join('/')}`;
	}

	private _mcpsDir(): string {
		return join(this._projectPath, ...MCPS_DIR);
	}

	private _toolSpecFileName(tool: string): string {
		const name = tool || 'tool';
		try {
			return encodeURIComponent(name);
		} catch {
			return Buffer.from(name).toString('base64url');
		}
	}

	private _containedPath(base: string, ...segments: string[]): string {
		const resolvedBase = resolve(base);
		const target = resolve(resolvedBase, ...segments);
		if (!isWithinDirectory(resolvedBase, target)) {
			throw new Error(`Resolved MCP path escapes ${resolvedBase}${sep}`);
		}
		return target;
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
