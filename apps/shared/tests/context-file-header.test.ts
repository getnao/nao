import { describe, expect, it } from 'vitest';

import {
	addContextFileHeader,
	getDefaultContextFileHeader,
	readContextFileHeader,
	updateContextFileHeader,
	validateContextFileHeader,
} from '../src/context-file-header';

describe('readContextFileHeader', () => {
	it('reads the header fields next to the other properties', () => {
		const content = [
			'---',
			'type: manual',
			'title: Revenue',
			'description: How we count revenue',
			'owner: ada@example.com',
			'tags: [finance, kpi]',
			'---',
			'# Revenue',
		].join('\n');

		expect(readContextFileHeader(content)).toEqual({
			header: {
				title: 'Revenue',
				description: 'How we count revenue',
				owner: 'ada@example.com',
				tags: ['finance', 'kpi'],
			},
			hasHeader: true,
			properties: ['type', 'title', 'description', 'owner', 'tags'],
			isGenerated: false,
			problems: [],
		});
	});

	it.each([
		['no frontmatter', '# Title', []],
		['an empty frontmatter', '---\n---\nbody', []],
		['comma separated tags', '---\ntags: finance, kpi , finance\n---\n', ['finance', 'kpi']],
		['a block list of tags', '---\ntags:\n  - finance\n  - 2024\n---\n', ['finance', '2024']],
	])('reads the tags of %s', (_, content, tags) => {
		expect(readContextFileHeader(content).header.tags).toEqual(tags);
	});

	it.each([
		['broken YAML', '---\ntitle: [unclosed\n---\n', 'invalid-header'],
		['a list instead of properties', '---\n- a\n- b\n---\n', 'invalid-header'],
		['a title that is not text', '---\ntitle:\n  nested: true\n---\n', 'invalid-field'],
		['tags that are not text', '---\ntags: [{ a: 1 }]\n---\n', 'invalid-field'],
	])('reports %s', (_, content, kind) => {
		expect(readContextFileHeader(content).problems.map((problem) => problem.kind)).toEqual([kind]);
	});
});

describe('validateContextFileHeader', () => {
	const userEmails = new Set(['ada@example.com']);

	it.each([
		['a known owner, whatever its case', '/notes.md', 'owner: Ada@Example.com', []],
		['an unknown owner', '/notes.md', 'owner: bob@example.com', ['unknown-owner']],
		['an unknown property', '/RULES.md', 'title: Rules\neaze: eaz', ['unknown-property']],
		['a type nao does not write', '/notes.md', 'type: draft', ['invalid-field']],
		['the source properties of a synced page', '/docs/notion/page.md', 'title: Page\nid: abc', []],
		['the name of a skill', '/agent/skills/top-customers.md', 'name: top\ndescription: Top', []],
		['the name of a SKILL.md skill', '/skills/top/SKILL.md', 'name: top', []],
		[
			'an unknown property of a skill',
			'/agent/skills/top-customers.md',
			'name: top\nnmae: x',
			['unknown-property'],
		],
		['a name outside the skills', '/docs/notes.md', 'name: top', ['unknown-property']],
		['the properties of a generated file', '/tables/orders.md', 'type: generated\nrows: 3', []],
	])('reports %s', (_, filePath, properties, kinds) => {
		const problems = validateContextFileHeader(`---\n${properties}\n---\n`, { filePath, userEmails });
		expect(problems.map((problem) => problem.kind)).toEqual(kinds);
	});

	it('leaves the owner unchecked without the users of the project', () => {
		expect(validateContextFileHeader('---\nowner: bob@example.com\n---\n', { filePath: '/notes.md' })).toEqual([]);
	});
});

describe('addContextFileHeader', () => {
	it('starts a header with every property, filled with the defaults', () => {
		const content = addContextFileHeader('# Rules\n', { title: 'Rules: main', description: null });

		expect(content).toBe('---\ntitle: "Rules: main"\ndescription:\nowner:\ntags: []\n---\n\n# Rules\n');
		expect(readContextFileHeader(content).header.title).toBe('Rules: main');
		expect(validateContextFileHeader(content, { filePath: '/RULES.md' })).toEqual([]);
	});

	it('leaves a file that already has a header untouched', () => {
		const content = '---\ntitle: A\n---\nbody';
		expect(addContextFileHeader(content, { title: 'B', description: null })).toBe(content);
	});
});

describe('updateContextFileHeader', () => {
	it('adds a frontmatter to a file that has none', () => {
		expect(updateContextFileHeader('# Revenue\n', { title: 'Revenue', tags: ['finance'] })).toBe(
			'---\ntitle: Revenue\ntags: [finance]\n---\n\n# Revenue\n',
		);
	});

	it('keeps the other properties, comments and the body as they are', () => {
		const content = '---\n# kept\ntype: manual\ntitle: Old\n---\n\nbody  \n';

		expect(updateContextFileHeader(content, { title: 'New', owner: 'ada@example.com' })).toBe(
			'---\n# kept\ntype: manual\ntitle: New\nowner: ada@example.com\n---\n\nbody  \n',
		);
	});

	it('removes the frontmatter once its last property is cleared', () => {
		expect(updateContextFileHeader('---\ntitle: Old\n---\n\nbody\n', { title: '' })).toBe('body\n');
	});

	it('keeps Windows line breaks', () => {
		expect(updateContextFileHeader('---\r\ntype: manual\r\n---\r\nbody', { title: 'A' })).toBe(
			'---\r\ntype: manual\r\ntitle: A\r\n---\r\nbody',
		);
	});

	it('leaves the file untouched when nothing changes', () => {
		const content = '---\ntitle:   Same\n---\nbody';
		expect(updateContextFileHeader(content, { title: 'Same', tags: [] })).toBe(content);
	});

	it('refuses to rewrite a header it cannot read', () => {
		expect(() => updateContextFileHeader('---\ntitle: [\n---\n', { title: 'A' })).toThrow();
	});
});

describe('getDefaultContextFileHeader', () => {
	it.each([
		['/docs/revenue_by-region.md', 'Revenue by region'],
		['/docs/MRR definition.md', 'MRR definition'],
		['/nested/RULES.md', 'Rules'],
		['README.md', 'Readme'],
	])('titles %s as %s', (filePath, title) => {
		expect(getDefaultContextFileHeader(filePath)).toEqual({ title, description: null });
	});

	it('describes the root RULES.md as the orchestrator of the context', () => {
		const { title, description } = getDefaultContextFileHeader('/RULES.md');

		expect(title).toBe('Rules');
		expect(description).toMatch(/orchestrate/);
		expect(description?.split('. ')).toHaveLength(2);
	});
});
