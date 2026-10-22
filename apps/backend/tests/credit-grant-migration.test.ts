import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('managed AI credit migration', () => {
	let sqlite: Database.Database;

	beforeEach(() => {
		sqlite = new Database(':memory:');
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

		const migration = readFileSync(
			new URL('../migrations-sqlite/0086_managed_ai_usage_wallet.sql', import.meta.url),
			'utf8',
		);
		sqlite.exec(migration);

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
});
