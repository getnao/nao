import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSyncOutboundPolicy } from '../src/services/sync-egress-policy';

let project: string;

beforeEach(() => {
	project = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-egress-policy-test-'));
});

afterEach(() => {
	fs.rmSync(project, { recursive: true, force: true });
});

describe('resolveSyncOutboundPolicy', () => {
	const publicDns = async () => ['93.184.216.34'];

	it('disables outbound networking when sync has no remote providers', async () => {
		writeConfig('project_name: local\n');

		await expect(resolveSyncOutboundPolicy(project, {}, { resolveAddresses: publicDns })).resolves.toEqual({
			mode: 'disabled',
		});
	});

	it('allows only exact hosts required by configured sync providers', async () => {
		writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: postgres
    host: {{ env('POSTGRES_HOST') }}
    password: {{ aws('warehouse/password') }}
  - name: databricks
    type: databricks
    server_hostname: adb-123.azuredatabricks.net
  - name: snowflake
    type: snowflake
    account_id: xy12345.us-east-1
  - name: bigquery
    type: bigquery
    project_id: sales
  - name: athena
    type: athena
    region_name: eu-west-1
    s3_staging_dir: s3://nao-results/query
  - name: lake
    type: ducklake
    catalog:
      type: postgres
      host: catalog.internal
    data_path: s3://nao-lake/data
    storage:
      type: s3
      region: us-east-2
repos:
  - name: app
    url: git@github.com:getnao/nao.git
notion:
  api_key: token
  pages: [page]
confluence:
  base_url: https://acme.atlassian.net/wiki
llm:
  providers:
    - provider: openai
      api_key: key
    - provider: bedrock
      aws_region: ap-southeast-2
    - provider: vertex
      gcp_location: europe-west1
    - provider: openaiCompatible/internal
      base_url: https://llm.example.com/v1
`);

		const policy = await resolveSyncOutboundPolicy(
			project,
			{ POSTGRES_HOST: 'postgres.internal' },
			{
				approvedPrivateWarehouseHosts: ['postgres.internal', 'catalog.internal'],
				resolveAddresses: publicDns,
			},
		);

		expect(policy).toMatchObject({ mode: 'enabled' });
		if (policy.mode !== 'enabled') {
			throw new Error('Expected enabled network policy.');
		}
		expect(policy.allowNet).toEqual(
			expect.arrayContaining([
				'postgres.internal',
				'adb-123.azuredatabricks.net',
				'xy12345.us-east-1.snowflakecomputing.com',
				'bigquery.googleapis.com',
				'athena.eu-west-1.amazonaws.com',
				'nao-results.s3.eu-west-1.amazonaws.com',
				'catalog.internal',
				'nao-lake.s3.us-east-2.amazonaws.com',
				'github.com',
				'objects.githubusercontent.com',
				'api.notion.com',
				'acme.atlassian.net',
				'api.openai.com',
				'bedrock-runtime.ap-southeast-2.amazonaws.com',
				'europe-west1-aiplatform.googleapis.com',
				'llm.example.com',
				'secretsmanager.us-east-1.amazonaws.com',
			]),
		);
		expect(policy.allowNet.every((host) => !host.includes('*'))).toBe(true);
		expect(policy.allowNet).not.toContain('evil.example');
	});

	it('fails closed when a configured destination cannot be resolved', async () => {
		writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: postgres
    host: {{ env('POSTGRES_HOST') }}
`);

		await expect(resolveSyncOutboundPolicy(project, {}, { resolveAddresses: publicDns })).rejects.toThrow(
			'Cannot determine sync network access without postgres.host.',
		);
	});

	it('fails closed for database types without an egress policy', async () => {
		writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: future-database
`);

		await expect(resolveSyncOutboundPolicy(project, {}, { resolveAddresses: publicDns })).rejects.toThrow(
			'unsupported database type "future-database"',
		);
	});

	it.each(['127.0.0.1', '169.254.169.254', '169.254.170.2', 'metadata.google.internal', '100.100.100.200'])(
		'never allows reserved destination %s, even when approved',
		async (destination) => {
			writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: postgres
    host: ${destination}
`);

			await expect(
				resolveSyncOutboundPolicy(
					project,
					{},
					{
						approvedPrivateWarehouseHosts: [destination],
						resolveAddresses: publicDns,
					},
				),
			).rejects.toThrow('reserved for host or cloud infrastructure');
		},
	);

	it('blocks hostnames that resolve to cloud metadata addresses', async () => {
		writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: postgres
    host: warehouse.example.com
`);

		await expect(
			resolveSyncOutboundPolicy(
				project,
				{},
				{
					approvedPrivateWarehouseHosts: ['warehouse.example.com'],
					resolveAddresses: async () => ['169.254.169.254'],
				},
			),
		).rejects.toThrow('resolves to reserved infrastructure address');
	});

	it('blocks deployment infrastructure even when configured and approved as a warehouse', async () => {
		writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: postgres
    host: database.nao.internal
`);

		await expect(
			resolveSyncOutboundPolicy(
				project,
				{},
				{
					approvedPrivateWarehouseHosts: ['database.nao.internal'],
					blockedInfrastructureHosts: ['database.nao.internal'],
					resolveAddresses: async () => ['10.20.30.40'],
				},
			),
		).rejects.toThrow('belongs to nao deployment infrastructure');
	});

	it('rejects a hostname when any DNS answer is private', async () => {
		writeConfig(`
project_name: sales
repos:
  - name: app
    url: https://repository.example.com/acme/app.git
`);

		await expect(
			resolveSyncOutboundPolicy(
				project,
				{},
				{
					resolveAddresses: async () => ['93.184.216.34', '10.20.30.40'],
				},
			),
		).rejects.toThrow('is private and is blocked by default');
	});

	it('requires a deployment-admin approval for private warehouse hosts', async () => {
		writeConfig(`
project_name: sales
databases:
  - name: warehouse
    type: postgres
    host: warehouse.example.com
`);
		const privateDns = async () => ['10.20.30.40'];

		await expect(resolveSyncOutboundPolicy(project, {}, { resolveAddresses: privateDns })).rejects.toThrow(
			'deployment admin must explicitly approve',
		);
		await expect(
			resolveSyncOutboundPolicy(
				project,
				{},
				{
					approvedPrivateWarehouseHosts: ['warehouse.example.com'],
					resolveAddresses: privateDns,
				},
			),
		).resolves.toEqual({ mode: 'enabled', allowNet: ['warehouse.example.com'] });
	});

	it('does not apply private warehouse approvals to other providers', async () => {
		writeConfig(`
project_name: sales
confluence:
  base_url: https://docs.internal
`);

		await expect(
			resolveSyncOutboundPolicy(
				project,
				{},
				{
					approvedPrivateWarehouseHosts: ['docs.internal'],
					resolveAddresses: async () => ['10.20.30.40'],
				},
			),
		).rejects.toThrow('is private and is blocked by default');
	});

	it('fails closed when an LLM provider host cannot be determined', async () => {
		writeConfig(`
project_name: sales
llm:
  provider: ollama
`);

		await expect(resolveSyncOutboundPolicy(project, {}, { resolveAddresses: publicDns })).rejects.toThrow(
			'LLM provider "ollama" without base_url',
		);
	});

	it('fails closed when a required hostname does not resolve', async () => {
		writeConfig(`
project_name: sales
repos:
  - name: app
    url: https://git.example.com/acme/app.git
`);

		await expect(resolveSyncOutboundPolicy(project, {}, { resolveAddresses: async () => [] })).rejects.toThrow(
			'did not resolve to an address',
		);
	});
});

function writeConfig(contents: string): void {
	fs.writeFileSync(path.join(project, 'nao_config.yaml'), contents);
}
