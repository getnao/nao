import dns from 'node:dns/promises';
import net from 'node:net';

import yaml from 'js-yaml';

import { syncUsesLlm } from '../utils/nao-config';
import { readProjectFile } from '../utils/project-file';
import { isPrivateAddress, isPrivateHostname } from '../utils/safe-fetch';

export interface SyncHostMapping {
	address: string;
	hostname: string;
}

export type SyncOutboundPolicy =
	| { mode: 'disabled'; hostMappings: SyncHostMapping[] }
	| { mode: 'enabled'; allowNet: string[]; hostMappings: SyncHostMapping[] };

type ConfigRecord = Record<string, unknown>;
type ResolveAddresses = (hostname: string) => Promise<string[]>;

export interface SyncEgressPolicyOptions {
	approvedPrivateWarehouseHosts?: Iterable<string>;
	blockedInfrastructureHosts?: Iterable<string>;
	resolveAddresses?: ResolveAddresses;
}

const ENV_REFERENCE_PATTERN = /\$?\{\{\s*env\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
const UNRESOLVED_REFERENCE_PATTERN = /\$?\{\{\s*(?:env|aws|k8s)\(/;
const EXTERNAL_SECRET_REFERENCE_PATTERN = /\$?\{\{\s*(?:aws|k8s)\(\s*['"][^'"]+['"]\s*\)\s*\}\}/g;
const AWS_SECRET_REFERENCE_PATTERN = /\$?\{\{\s*aws\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
const K8S_SECRET_REFERENCE_PATTERN = /\$?\{\{\s*k8s\(/;
const UNRESOLVED_SECRET = '__NAO_UNRESOLVED_SECRET__';
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;
const BLOCKED_HOSTS = new Set([
	'localhost',
	'host.docker.internal',
	'gateway.docker.internal',
	'instance-data.ec2.internal',
	'metadata.google.internal',
	'metadata.goog',
	'100.100.100.200',
]);
const BLOCKED_IPV4_ADDRESSES = new Set(['100.100.100.200', '169.254.169.254']);

const DATABASE_HOST_FIELDS: Record<string, string> = {
	clickhouse: 'host',
	databricks: 'server_hostname',
	fabric: 'host',
	mssql: 'host',
	mysql: 'host',
	postgres: 'host',
	redshift: 'host',
	starrocks: 'host',
	trino: 'host',
};

const LLM_HOSTS: Record<string, string[]> = {
	openai: ['api.openai.com'],
	anthropic: ['api.anthropic.com'],
	mistral: ['api.mistral.ai'],
	gemini: ['generativelanguage.googleapis.com', 'oauth2.googleapis.com'],
	openrouter: ['openrouter.ai'],
	requesty: ['router.requesty.ai'],
	qwen: ['dashscope-intl.aliyuncs.com'],
	minimax: ['api.minimax.io'],
	moonshot: ['api.moonshot.ai'],
	meta: ['api.meta.ai'],
};

export async function resolveSyncOutboundPolicy(
	projectPath: string,
	projectEnvVars: Record<string, string>,
	options: SyncEgressPolicyOptions = {},
): Promise<SyncOutboundPolicy> {
	const { config, awsSecretRegions, usesK8sSecrets } = loadConfig(projectPath, projectEnvVars);
	const hosts = new Set<string>();
	const privateWarehouseHosts = new Set<string>();
	for (const region of awsSecretRegions) {
		addAwsHosts(hosts, region, ['secretsmanager', 'sts']);
	}
	if (usesK8sSecrets) {
		addConfiguredHost(hosts, projectEnvVars.KUBERNETES_SERVICE_HOST, projectEnvVars, 'KUBERNETES_SERVICE_HOST');
	}
	addDatabaseHosts(hosts, privateWarehouseHosts, config.databases, projectEnvVars);
	addRepositoryHosts(hosts, config.repos, projectEnvVars);
	addIntegrationHosts(hosts, config, projectEnvVars);
	if (syncUsesLlm(config.databases, projectPath)) {
		addLlmHosts(hosts, config.llm, projectEnvVars);
	}
	const { allowNet, hostMappings } = await resolveAllowedHosts(
		[...hosts].sort(),
		privateWarehouseHosts,
		new Set([...(options.approvedPrivateWarehouseHosts ?? [])].map(normalizeHost)),
		new Set([...(options.blockedInfrastructureHosts ?? [])].map(canonicalizeHost)),
		options.resolveAddresses ?? resolveAddresses,
	);
	return allowNet.length > 0 ? { mode: 'enabled', allowNet, hostMappings } : { mode: 'disabled', hostMappings };
}

function loadConfig(
	projectPath: string,
	envVars: Record<string, string>,
): { config: ConfigRecord; awsSecretRegions: Set<string>; usesK8sSecrets: boolean } {
	const source = readProjectFile(projectPath, 'nao_config.yaml');
	const awsSecretRegions = new Set(
		[...source.matchAll(AWS_SECRET_REFERENCE_PATTERN)].map(
			([, identifier]) =>
				identifier.match(/^arn:aws:secretsmanager:([^:]+):/)?.[1] || envVars.AWS_REGION || 'us-east-1',
		),
	);
	const usesK8sSecrets = K8S_SECRET_REFERENCE_PATTERN.test(source);
	const contents = source
		.replace(ENV_REFERENCE_PATTERN, (_match, name: string) => envVars[name] ?? '')
		.replace(EXTERNAL_SECRET_REFERENCE_PATTERN, UNRESOLVED_SECRET);
	let config: unknown;
	try {
		config = yaml.load(contents);
	} catch {
		throw new Error('Cannot determine sync network access because nao_config.yaml could not be parsed.');
	}
	if (!isRecord(config)) {
		throw new Error('Cannot determine sync network access because nao_config.yaml is not an object.');
	}
	return { config, awsSecretRegions, usesK8sSecrets };
}

function addDatabaseHosts(
	hosts: Set<string>,
	privateWarehouseHosts: Set<string>,
	databases: unknown,
	envVars: Record<string, string>,
): void {
	if (databases !== undefined && !Array.isArray(databases)) {
		throw new Error('Cannot determine sync network access because databases is not an array.');
	}
	if (!Array.isArray(databases)) {
		return;
	}
	for (const database of databases) {
		if (!isRecord(database)) {
			throw new Error('Cannot determine sync network access because a database is not an object.');
		}
		const type = resolvedString(database.type, envVars, 'database type');
		if (!type) {
			throw new Error('Cannot determine sync network access for a database without a type.');
		}
		const hostField = DATABASE_HOST_FIELDS[type];
		if (hostField) {
			addConfiguredWarehouseHost(
				hosts,
				privateWarehouseHosts,
				database[hostField],
				envVars,
				`${type}.${hostField}`,
			);
		} else {
			addSpecialDatabaseHosts(hosts, privateWarehouseHosts, type, database, envVars);
		}
		const authMode = resolvedString(database.auth_mode, envVars, `${type}.auth_mode`);
		if (type === 'fabric' && (authMode || 'sql_password') !== 'sql_password') {
			hosts.add('login.microsoftonline.com');
		}
		if (type === 'redshift' && authMode === 'iam') {
			addAwsServiceHosts(hosts, database, envVars, ['redshift']);
		}
		if (type === 'redshift' && isRecord(database.ssh_tunnel)) {
			addConfiguredWarehouseHost(
				hosts,
				privateWarehouseHosts,
				database.ssh_tunnel.ssh_host,
				envVars,
				'redshift.ssh_tunnel.ssh_host',
			);
		}
	}
}

function addSpecialDatabaseHosts(
	hosts: Set<string>,
	privateWarehouseHosts: Set<string>,
	type: string,
	database: ConfigRecord,
	envVars: Record<string, string>,
): void {
	switch (type) {
		case 'athena':
			addAwsServiceHosts(hosts, database, envVars, ['athena', 'glue']);
			addS3Hosts(hosts, database.s3_staging_dir, database.region_name, envVars);
			return;
		case 'bigquery':
			hosts.add('bigquery.googleapis.com');
			hosts.add('bigquerystorage.googleapis.com');
			hosts.add('oauth2.googleapis.com');
			hosts.add('accounts.google.com');
			return;
		case 'duckdb': {
			const databasePath = resolvedString(database.path, envVars, 'duckdb.path');
			if (/^(?:md|motherduck):/i.test(databasePath)) {
				addMotherDuckHosts(hosts);
			}
			return;
		}
		case 'ducklake':
			addDuckLakeHosts(hosts, privateWarehouseHosts, database, envVars);
			return;
		case 'motherduck':
			addMotherDuckHosts(hosts);
			return;
		case 'snowflake':
			addSnowflakeHosts(hosts, privateWarehouseHosts, database.account_id, envVars);
			return;
		default:
			throw new Error(`Cannot determine sync network access for unsupported database type "${type}".`);
	}
}

function addMotherDuckHosts(hosts: Set<string>): void {
	hosts.add('api.motherduck.com');
	hosts.add('extensions.duckdb.org');
}

function addDuckLakeHosts(
	hosts: Set<string>,
	privateWarehouseHosts: Set<string>,
	database: ConfigRecord,
	envVars: Record<string, string>,
): void {
	hosts.add('extensions.duckdb.org');
	if (isRecord(database.catalog) && ['postgres', 'mysql'].includes(String(database.catalog.type))) {
		addConfiguredWarehouseHost(
			hosts,
			privateWarehouseHosts,
			database.catalog.host,
			envVars,
			'ducklake.catalog.host',
		);
	}
	if (isRecord(database.storage)) {
		if (database.storage.endpoint) {
			addConfiguredWarehouseHost(
				hosts,
				privateWarehouseHosts,
				database.storage.endpoint,
				envVars,
				'ducklake.storage.endpoint',
			);
		}
	}
	addS3Hosts(hosts, database.data_path, isRecord(database.storage) ? database.storage.region : undefined, envVars);
}

function addSnowflakeHosts(
	hosts: Set<string>,
	privateWarehouseHosts: Set<string>,
	accountValue: unknown,
	envVars: Record<string, string>,
): void {
	const resolvedAccount = resolvedString(accountValue, envVars, 'snowflake.account_id');
	if (!resolvedAccount) {
		throw new Error('Cannot determine sync network access without snowflake.account_id.');
	}
	const account = normalizeHost(resolvedAccount);
	const suffix = account.endsWith('.cn') ? 'snowflakecomputing.cn' : 'snowflakecomputing.com';
	addWarehouseHost(hosts, privateWarehouseHosts, `${account}.${suffix}`);
	hosts.add(`ocsp.${suffix}`);
}

function addRepositoryHosts(hosts: Set<string>, repos: unknown, envVars: Record<string, string>): void {
	if (repos !== undefined && !Array.isArray(repos)) {
		throw new Error('Cannot determine sync network access because repos is not an array.');
	}
	if (!Array.isArray(repos)) {
		return;
	}
	for (const repo of repos) {
		if (!isRecord(repo)) {
			throw new Error('Cannot determine sync network access for a repository without a URL.');
		}
		if (!repo.url && typeof repo.local_path === 'string' && repo.local_path.trim()) {
			continue;
		}
		if (!repo.url) {
			throw new Error('Cannot determine sync network access for a repository without a URL.');
		}
		const host = hostFromUrlOrGitRemote(resolvedString(repo.url, envVars, 'repos.url'));
		hosts.add(host);
		if (host === 'github.com') {
			hosts.add('github-cloud.s3.amazonaws.com');
			hosts.add('codeload.github.com');
			hosts.add('objects.githubusercontent.com');
			hosts.add('raw.githubusercontent.com');
		}
	}
}

function addIntegrationHosts(hosts: Set<string>, config: ConfigRecord, envVars: Record<string, string>): void {
	if (config.notion !== undefined && !isRecord(config.notion)) {
		throw new Error('Cannot determine sync network access because notion is not an object.');
	}
	if (isRecord(config.notion)) {
		hosts.add('api.notion.com');
	}
	if (config.confluence !== undefined && !isRecord(config.confluence)) {
		throw new Error('Cannot determine sync network access because confluence is not an object.');
	}
	if (isRecord(config.confluence)) {
		addConfiguredHost(hosts, config.confluence.base_url, envVars, 'confluence.base_url');
	}
}

function addLlmHosts(hosts: Set<string>, llmValue: unknown, envVars: Record<string, string>): void {
	if (llmValue === undefined) {
		return;
	}
	if (!isRecord(llmValue)) {
		throw new Error('Cannot determine sync network access because llm is not an object.');
	}
	const providers = Array.isArray(llmValue.providers) ? llmValue.providers : [llmValue];
	for (const providerValue of providers) {
		if (!isRecord(providerValue)) {
			throw new Error('Cannot determine sync network access because an LLM provider is not an object.');
		}
		const providerId = resolvedString(providerValue.provider, envVars, 'llm.provider');
		if (!providerId) {
			throw new Error('Cannot determine sync network access without llm.provider.');
		}
		const provider = providerId.split('/', 1)[0] === 'google' ? 'gemini' : providerId.split('/', 1)[0];
		const baseUrl = resolvedString(providerValue.base_url, envVars, 'llm.base_url');
		if (baseUrl) {
			hosts.add(hostFromUrlOrGitRemote(baseUrl));
		} else if (LLM_HOSTS[provider]) {
			for (const host of LLM_HOSTS[provider]) {
				hosts.add(host);
			}
		} else if (!['bedrock', 'vertex'].includes(provider)) {
			throw new Error(`Cannot determine sync network access for LLM provider "${providerId}" without base_url.`);
		}
		if (baseUrl || LLM_HOSTS[provider]) {
			continue;
		}
		if (provider === 'bedrock') {
			const region = resolvedString(providerValue.aws_region, envVars, 'llm.aws_region') || envVars.AWS_REGION;
			addAwsHosts(hosts, region || 'us-east-1', ['bedrock-runtime', 'sts']);
		}
		if (provider === 'vertex') {
			const location =
				resolvedString(providerValue.gcp_location, envVars, 'llm.gcp_location') ||
				envVars.GOOGLE_VERTEX_LOCATION ||
				'us-central1';
			hosts.add(`${location}-aiplatform.googleapis.com`);
			hosts.add('oauth2.googleapis.com');
		}
	}
}

function addAwsServiceHosts(
	hosts: Set<string>,
	config: ConfigRecord,
	envVars: Record<string, string>,
	services: string[],
): void {
	const region = resolvedString(config.region_name, envVars, 'AWS region') || envVars.AWS_REGION || 'us-east-1';
	addAwsHosts(hosts, region, [...services, 'sts']);
}

function addAwsHosts(hosts: Set<string>, region: string, services: string[]): void {
	const suffix = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
	for (const service of services) {
		hosts.add(`${service}.${region}.${suffix}`);
	}
	if (!region.startsWith('cn-')) {
		hosts.add('sts.amazonaws.com');
	}
}

function addS3Hosts(
	hosts: Set<string>,
	pathValue: unknown,
	regionValue: unknown,
	envVars: Record<string, string>,
): void {
	const storagePath = resolvedString(pathValue, envVars, 'S3 path');
	if (!storagePath.startsWith('s3://')) {
		return;
	}
	const bucket = new URL(storagePath).hostname;
	const region = resolvedString(regionValue, envVars, 'S3 region') || envVars.AWS_REGION || 'us-east-1';
	const suffix = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
	hosts.add(`s3.${region}.${suffix}`);
	hosts.add(`${bucket}.s3.${region}.${suffix}`);
	if (region === 'us-east-1') {
		hosts.add('s3.amazonaws.com');
		hosts.add(`${bucket}.s3.amazonaws.com`);
	}
}

function addConfiguredHost(hosts: Set<string>, value: unknown, envVars: Record<string, string>, field: string): void {
	const resolved = resolvedString(value, envVars, field);
	if (!resolved) {
		throw new Error(`Cannot determine sync network access without ${field}.`);
	}
	hosts.add(hostFromUrlOrGitRemote(resolved));
}

function addConfiguredWarehouseHost(
	hosts: Set<string>,
	privateWarehouseHosts: Set<string>,
	value: unknown,
	envVars: Record<string, string>,
	field: string,
): void {
	const resolved = resolvedString(value, envVars, field);
	if (!resolved) {
		throw new Error(`Cannot determine sync network access without ${field}.`);
	}
	addWarehouseHost(hosts, privateWarehouseHosts, hostFromUrlOrGitRemote(resolved));
}

function addWarehouseHost(hosts: Set<string>, privateWarehouseHosts: Set<string>, value: string): void {
	const host = normalizeHost(value);
	hosts.add(host);
	privateWarehouseHosts.add(host);
}

function resolvedString(value: unknown, envVars: Record<string, string>, field: string): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value !== 'string' && typeof value !== 'number') {
		throw new Error(`Cannot determine sync network access because ${field} is not a string.`);
	}
	const resolved = String(value).replace(ENV_REFERENCE_PATTERN, (_match, name: string) => envVars[name] ?? '');
	if (UNRESOLVED_REFERENCE_PATTERN.test(resolved) || resolved.includes(UNRESOLVED_SECRET)) {
		throw new Error(`Cannot determine sync network access because ${field} uses an unresolved secret reference.`);
	}
	return resolved.trim();
}

function hostFromUrlOrGitRemote(value: string): string {
	const gitRemote = value.match(/^[^@\s]+@(\[[^\]]+\]|[^:/\s]+):/);
	if (gitRemote) {
		return normalizeHost(gitRemote[1]);
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
		return normalizeHost(new URL(value).hostname);
	}
	const hostWithPort = value.match(/^(\[[^\]]+\]|[^:/\s]+):\d+$/);
	return normalizeHost(hostWithPort?.[1] ?? value);
}

function normalizeHost(value: string): string {
	const host = canonicalizeHost(value);
	if (net.isIP(host) === 6) {
		throw new Error(`Cannot allow IPv6 sync destination "${host}" because BoxLite allowNet supports IPv4 only.`);
	}
	if (net.isIP(host) === 0 && !HOST_PATTERN.test(host)) {
		throw new Error(`Cannot determine sync network access from invalid host "${value}".`);
	}
	if (BLOCKED_HOSTS.has(host) || isAlwaysBlockedIpv4(host)) {
		throw new Error(`Sync destination "${host}" is reserved for host or cloud infrastructure.`);
	}
	return host;
}

function canonicalizeHost(value: string): string {
	return value
		.trim()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '')
		.toLowerCase();
}

function isAlwaysBlockedIpv4(host: string): boolean {
	if (net.isIP(host) !== 4) {
		return false;
	}
	const [first, second] = host.split('.').map(Number);
	return (
		BLOCKED_IPV4_ADDRESSES.has(host) ||
		first === 0 ||
		first === 127 ||
		(first === 169 && second === 254) ||
		first >= 224
	);
}

async function resolveAllowedHosts(
	hosts: string[],
	privateWarehouseHosts: Set<string>,
	approvedPrivateWarehouseHosts: Set<string>,
	blockedInfrastructureHosts: Set<string>,
	resolve: ResolveAddresses,
): Promise<{ allowNet: string[]; hostMappings: SyncHostMapping[] }> {
	const allowedAddresses = new Set<string>();
	const hostMappings: SyncHostMapping[] = [];
	for (const host of hosts) {
		if (blockedInfrastructureHosts.has(host)) {
			throw new Error(`Sync destination "${host}" belongs to nao deployment infrastructure and is blocked.`);
		}
		const privateWarehouseApproved = privateWarehouseHosts.has(host) && approvedPrivateWarehouseHosts.has(host);
		if (isPrivateHostname(host) && !privateWarehouseApproved) {
			throw privateDestinationError(host, privateWarehouseHosts.has(host));
		}
		const addresses = net.isIP(host) ? [host] : await resolve(host);
		if (addresses.length === 0) {
			throw new Error(`Cannot determine sync network access because "${host}" did not resolve to an address.`);
		}
		const ipv4Addresses = new Set<string>();
		for (const address of addresses) {
			if (net.isIP(address) === 4) {
				if (isAlwaysBlockedIpv4(address)) {
					throw new Error(
						`Sync destination "${host}" resolves to reserved infrastructure address "${address}".`,
					);
				}
				ipv4Addresses.add(address);
			}
			if (isPrivateAddress(address) && !privateWarehouseApproved) {
				throw privateDestinationError(host, privateWarehouseHosts.has(host));
			}
		}
		if (ipv4Addresses.size === 0) {
			throw new Error(
				`Cannot allow IPv6-only sync destination "${host}" because BoxLite allowNet supports IPv4 only.`,
			);
		}
		for (const address of ipv4Addresses) {
			// ponytail: IP rules allow every port on the destination; replace them when BoxLite supports host-and-port rules.
			allowedAddresses.add(address);
			if (net.isIP(host) === 0) {
				hostMappings.push({ address, hostname: host });
			}
		}
	}
	hostMappings.sort(
		(left, right) => left.hostname.localeCompare(right.hostname) || left.address.localeCompare(right.address),
	);
	return { allowNet: [...allowedAddresses].sort(), hostMappings };
}

async function resolveAddresses(hostname: string): Promise<string[]> {
	try {
		return (await dns.lookup(hostname, { all: true })).map(({ address }) => address);
	} catch {
		throw new Error(`Cannot determine sync network access because hostname "${hostname}" could not be resolved.`);
	}
}

function privateDestinationError(host: string, isWarehouse: boolean): Error {
	const approval = isWarehouse
		? ' A deployment admin must explicitly approve this private warehouse host for the project.'
		: '';
	return new Error(`Sync destination "${host}" is private and is blocked by default.${approval}`);
}

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
