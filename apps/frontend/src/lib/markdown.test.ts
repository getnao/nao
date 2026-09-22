import { describe, expect, it } from 'vitest';

import { joinMarkdownFrontmatter, parseMarkdownFrontmatter } from './markdown';

describe('parseMarkdownFrontmatter', () => {
	it('parses leading YAML frontmatter', () => {
		const content = '---\ntype: manual\ncomment: Notes\n---\n\n# Context';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: '---\ntype: manual\ncomment: Notes\n---\n',
			label: 'Manual',
			body: '\n# Context',
		});
	});

	it('parses frontmatter with a UTF-8 BOM', () => {
		const content = '\uFEFF---\ntype: manual\n---\nContext';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: '\uFEFF---\ntype: manual\n---\n',
			label: 'Manual',
			body: 'Context',
		});
	});

	it('parses frontmatter with CRLF line endings', () => {
		const content = '---\r\ntype: manual\r\n---\r\nContext';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: '---\r\ntype: manual\r\n---\r\n',
			label: 'Manual',
			body: 'Context',
		});
	});

	it('accepts the YAML document end marker', () => {
		const content = '---\ntype: manual\n...\nContext';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: '---\ntype: manual\n...\n',
			label: 'Manual',
			body: 'Context',
		});
	});

	it('derives a generated label', () => {
		const content = '---\ntype: generated\n---\nContext';

		expect(parseMarkdownFrontmatter(content).label).toBe('Generated');
	});

	it('strips quotes and whitespace from the type label', () => {
		const content = '---\ntype:   "manual"  \n---\nContext';

		expect(parseMarkdownFrontmatter(content).label).toBe('Manual');
	});

	it('returns no label when type is missing', () => {
		const content = '---\ncomment: Notes\n---\nContext';

		expect(parseMarkdownFrontmatter(content).label).toBeNull();
	});

	it('does not use an indented type for the label', () => {
		const content = '---\n  type: manual\n---\nContext';

		expect(parseMarkdownFrontmatter(content).label).toBeNull();
	});

	it('returns no label when type is empty', () => {
		const content = "---\ntype: ''\n---\nContext";

		expect(parseMarkdownFrontmatter(content).label).toBeNull();
	});

	it('leaves content without frontmatter untouched', () => {
		const content = '# Context\n\nNotes';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: null,
			label: null,
			body: content,
		});
	});

	it('leaves unterminated frontmatter untouched', () => {
		const content = '---\ntype: manual\nContext';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: null,
			label: null,
			body: content,
		});
	});

	it('returns an empty body for a frontmatter-only file', () => {
		const content = '---\ntype: manual\n---';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: content,
			label: 'Manual',
			body: '',
		});
	});

	it('preserves the exact content when frontmatter and body are recombined', () => {
		const contents = [
			'# Context\n\nNotes',
			'---\ntype: manual\n---\nContext',
			'---\r\ntype: manual\r\n---\r\nContext',
			'\uFEFF---\ntype: manual\n---\nContext',
			'---\ntype: manual\n...\nContext',
			'---\ntype: manual\n---',
		];

		for (const content of contents) {
			const parsed = parseMarkdownFrontmatter(content);
			expect((parsed.frontmatter ?? '') + parsed.body).toBe(content);
		}
	});

	it('keeps horizontal rules in the document body', () => {
		const content = '---\ntype: manual\n---\nContext\n\n---\n\nMore';

		expect(parseMarkdownFrontmatter(content).body).toBe('Context\n\n---\n\nMore');
	});

	it('leaves frontmatter after a leading blank line untouched', () => {
		const content = '\n---\ntype: manual\n---\nContext';

		expect(parseMarkdownFrontmatter(content)).toEqual({
			frontmatter: null,
			label: null,
			body: content,
		});
	});
});

describe('joinMarkdownFrontmatter', () => {
	it('inserts a newline before a non-empty body when the prefix has none', () => {
		expect(joinMarkdownFrontmatter('---\ntype: manual\n---', 'hello')).toBe('---\ntype: manual\n---\nhello');
	});

	it('leaves a prefix without a trailing newline unchanged for an empty body', () => {
		const frontmatter = '---\ntype: manual\n---';

		expect(joinMarkdownFrontmatter(frontmatter, '')).toBe(frontmatter);
	});

	it('does not add a newline when the prefix already ends with one', () => {
		expect(joinMarkdownFrontmatter('---\ntype: manual\n---\n', 'hello')).toBe('---\ntype: manual\n---\nhello');
	});

	it('returns the body unchanged without a frontmatter prefix', () => {
		expect(joinMarkdownFrontmatter(null, 'hello')).toBe('hello');
	});

	it('reproduces parsed content exactly when the body is unchanged', () => {
		const contents = [
			'---\ntype: manual\n---',
			'---\r\ntype: manual\r\n---\r\nContext',
			'---\ntype: manual\n---\nContext',
		];

		for (const content of contents) {
			const parsed = parseMarkdownFrontmatter(content);
			expect(joinMarkdownFrontmatter(parsed.frontmatter, parsed.body)).toBe(content);
		}
	});
});
