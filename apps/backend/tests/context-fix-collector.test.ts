import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContextFixCollector } from '../src/agents/tools/propose-context-fix';
import { fingerprintFor } from '../src/services/context-recommendations.reconcile';

describe('context fix collector repository boundaries', () => {
	const temporaryRoots: string[] = [];

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('rejects context edits without a connected context repository', async () => {
		const projectFolder = createProjectFolder(temporaryRoots);
		const collector = createContextFixCollector(projectFolder, [], { allowContextEdits: false });

		await expect(
			runEdit(collector, {
				suggestedFile: 'RULES.md',
				subjectKey: 'context-rule',
				path: 'RULES.md',
				old_string: 'old',
				new_string: 'new',
			}),
		).rejects.toThrow('no repository is connected for context pull requests');
		expect(collector.getFix(fingerprintFor('RULES.md', 'context-rule'))).toBeNull();
	});

	it('lets an existing empty file receive its first content', async () => {
		const projectFolder = createProjectFolder(temporaryRoots);
		fs.mkdirSync(path.join(projectFolder, 'semantics'), { recursive: true });
		fs.writeFileSync(path.join(projectFolder, 'semantics/orders.md'), '');
		const collector = createContextFixCollector(projectFolder);

		await runEdit(collector, {
			suggestedFile: 'semantics/orders.md',
			subjectKey: 'orders-doc',
			path: 'semantics/orders.md',
			new_string: '# Orders\n',
		});

		expect(collector.getFix(fingerprintFor('semantics/orders.md', 'orders-doc'))).toMatchObject({
			fixKind: 'patch',
			proposedEdits: [{ path: 'semantics/orders.md', kind: 'edit', oldContent: '', newContent: '# Orders\n' }],
		});
	});

	it('merges a later edit into a file created earlier in the same recommendation', async () => {
		const projectFolder = createProjectFolder(temporaryRoots);
		const collector = createContextFixCollector(projectFolder);

		await runEdit(collector, {
			suggestedFile: 'semantics/new.md',
			subjectKey: 'new-doc',
			path: 'semantics/new.md',
			new_string: 'line one\nline two\n',
		});
		await runEdit(collector, {
			suggestedFile: 'semantics/new.md',
			subjectKey: 'new-doc',
			path: 'semantics/new.md',
			old_string: 'line two',
			new_string: 'line 2',
		});

		expect(collector.getFix(fingerprintFor('semantics/new.md', 'new-doc'))).toMatchObject({
			fixKind: 'patch',
			proposedEdits: [
				{ path: 'semantics/new.md', kind: 'create', oldContent: '', newContent: 'line one\nline 2\n' },
			],
		});
	});

	it('rejects whole-file replacement of a file created earlier in the same recommendation', async () => {
		const projectFolder = createProjectFolder(temporaryRoots);
		const collector = createContextFixCollector(projectFolder);

		await runEdit(collector, {
			suggestedFile: 'semantics/new.md',
			subjectKey: 'new-doc',
			path: 'semantics/new.md',
			new_string: 'first content\n',
		});
		await expect(
			runEdit(collector, {
				suggestedFile: 'semantics/new.md',
				subjectKey: 'new-doc',
				path: 'semantics/new.md',
				new_string: 'clobbering content\n',
			}),
		).rejects.toThrow('already has content');
	});

	it('allows linked repository edits without a connected context repository', async () => {
		const projectFolder = createProjectFolder(temporaryRoots);
		const collector = createContextFixCollector(
			projectFolder,
			[
				{
					name: 'dbt-models',
					contextPath: 'repos/dbt-models',
					repoFullName: 'nao/dbt-models',
					branch: 'main',
					url: 'https://github.com/nao/dbt-models.git',
					localPath: null,
					provider: 'github',
				},
			],
			{ allowContextEdits: false },
		);

		await runEdit(collector, {
			suggestedFile: 'repos/dbt-models/models/orders.sql',
			subjectKey: 'orders-model',
			path: 'repos/dbt-models/models/orders.sql',
			old_string: 'old',
			new_string: 'new',
		});

		expect(collector.getFix(fingerprintFor('repos/dbt-models/models/orders.sql', 'orders-model'))).toMatchObject({
			fixKind: 'patch',
			proposedEdits: [
				{
					path: 'repos/dbt-models/models/orders.sql',
					newContent: 'new',
					targetRepo: {
						repoFullName: 'nao/dbt-models',
						branch: 'main',
						path: 'models/orders.sql',
						provider: 'github',
					},
				},
			],
		});
	});
});

type Collector = ReturnType<typeof createContextFixCollector>;
type EditInput = Parameters<NonNullable<Collector['editTool']['execute']>>[0];

function runEdit(collector: Collector, input: EditInput) {
	return collector.editTool.execute!(input, {} as never);
}

function createProjectFolder(temporaryRoots: string[]): string {
	const projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-fix-'));
	temporaryRoots.push(projectFolder);
	fs.writeFileSync(path.join(projectFolder, 'RULES.md'), 'old');
	fs.mkdirSync(path.join(projectFolder, 'repos/dbt-models/models'), { recursive: true });
	fs.writeFileSync(path.join(projectFolder, 'repos/dbt-models/models/orders.sql'), 'old');
	return projectFolder;
}
