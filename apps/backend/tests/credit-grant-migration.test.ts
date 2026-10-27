import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('managed AI credit migration', () => {
	let sqlite: Database.Database;

	beforeEach(() => {
		sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys = ON');
		sqlite.exec(`
			CREATE TABLE user (id text PRIMARY KEY, requires_password_reset integer NOT NULL);
			CREATE TABLE session (id text PRIMARY KEY, user_id text NOT NULL);
			CREATE TABLE organization (id text PRIMARY KEY);
			CREATE TABLE org_member (org_id text NOT NULL, user_id text NOT NULL, created_at integer NOT NULL);
			CREATE TABLE project (id text PRIMARY KEY, org_id text, created_at integer NOT NULL);
			CREATE TABLE project_member (project_id text NOT NULL, user_id text NOT NULL, created_at integer NOT NULL);
		`);
	});

	afterEach(() => {
		sqlite.close();
	});

	it('backfills existing memberships while keeping inactive invitees pending', () => {
		sqlite.exec(`
			INSERT INTO user (id, requires_password_reset) VALUES ('active-user', 0), ('invited-user', 1);
			INSERT INTO organization (id) VALUES ('org');
			INSERT INTO org_member (org_id, user_id, created_at) VALUES ('org', 'active-user', 1000);
			INSERT INTO project (id, org_id, created_at) VALUES ('project', 'org', 1500);
			INSERT INTO project_member (project_id, user_id, created_at) VALUES ('project', 'invited-user', 2000);
		`);

		sqlite.exec(readMigration('0088_managed_ai_usage_wallet.sql'));

		expect(
			sqlite
				.prepare('SELECT source_key, activated_at, created_at FROM credit_grant_candidate ORDER BY created_at')
				.all(),
		).toEqual([
			{
				source_key: 'org-member:org:active-user',
				activated_at: expect.any(Number),
				created_at: 1000,
			},
			{
				source_key: 'project:project',
				activated_at: null,
				created_at: 1500,
			},
			{
				source_key: 'project-member:project:invited-user',
				activated_at: null,
				created_at: 2000,
			},
		]);
	});

	it('upgrades databases that already applied the credit migrations', () => {
		sqlite.exec(readMigration('0088_managed_ai_usage_wallet.sql'));
		sqlite.exec(readMigration('0089_example_chat_allowance.sql'));
		sqlite.exec(readMigration('0090_managed_ai_credit_ledger_fields.sql'));

		expect(
			sqlite.prepare('SELECT grant_type, max_grants_per_org FROM credit_grant_policy ORDER BY grant_type').all(),
		).toEqual([
			{ grant_type: 'organization_setup', max_grants_per_org: 1 },
			{ grant_type: 'user_join', max_grants_per_org: 100 },
		]);

		sqlite
			.prepare(
				`
				INSERT INTO credit_ledger (
					id,
					entry_type,
					delta_micro_usd,
					balance_after_micro_usd,
					idempotency_key,
					grant_type,
					purchase_payment_intent_id
				) VALUES (?, 'grant', 5000000, 5000000, ?, ?, ?)
			`,
			)
			.run('ledger', 'grant:user', 'user_join', 'pi_123');

		expect(
			sqlite
				.prepare('SELECT grant_type, purchase_payment_intent_id FROM credit_ledger WHERE id = ?')
				.get('ledger'),
		).toEqual({ grant_type: 'user_join', purchase_payment_intent_id: 'pi_123' });
		expect(
			sqlite
				.prepare(
					`
					SELECT name
					FROM sqlite_master
					WHERE type = 'index'
						AND tbl_name = 'credit_ledger'
						AND name IN (
							'credit_ledger_walletId_grantType_idx',
							'credit_ledger_purchasePaymentIntentId_idx'
						)
					ORDER BY name
				`,
				)
				.all(),
		).toEqual([
			{ name: 'credit_ledger_purchasePaymentIntentId_idx' },
			{ name: 'credit_ledger_walletId_grantType_idx' },
		]);
		expect(() => {
			sqlite
				.prepare(
					`
					INSERT INTO credit_ledger (
						id,
						entry_type,
						delta_micro_usd,
						balance_after_micro_usd,
						idempotency_key,
						grant_type
					) VALUES ('invalid-grant', 'grant', 1, 1, 'invalid-grant', 'unknown')
				`,
				)
				.run();
		}).toThrow(/FOREIGN KEY constraint failed/);
	});
});

function readMigration(fileName: string): string {
	return readFileSync(new URL(`../migrations-sqlite/${fileName}`, import.meta.url), 'utf8');
}
