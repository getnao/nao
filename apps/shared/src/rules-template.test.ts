import { describe, expect, it } from 'vitest';

import {
	isRootRulesPath,
	renderConditionalGroupBlocks,
	renderConditionalGroupBlocksWithSourceLines,
} from './rules-template';

const licensed = (groupNames: string[]) => ({ enforced: true as const, groupNames });
const unlicensed = { enforced: false as const };

describe('renderConditionalGroupBlocks', () => {
	it('includes a matching group and removes directive lines', () => {
		const source = ['Always', '{% if group("finance") %}', 'Finance only', '{% endif %}', 'Done'].join('\n');

		expect(renderConditionalGroupBlocks(source, licensed(['finance']))).toBe(
			['Always', 'Finance only', 'Done'].join('\n'),
		);
	});

	it('matches any name in a multi-group condition using exact names', () => {
		const source = '{% if group("Finance Team", "marketing") %}\nShared rule\n{% endif %}\n';

		expect(renderConditionalGroupBlocks(source, licensed(['marketing']))).toBe('Shared rule\n');
		expect(renderConditionalGroupBlocks(source, licensed(['finance team']))).toBe('');
	});

	it('omits blocks for unknown or unmatched groups', () => {
		const source = 'Before\n{% if group("unknown") %}\nSecret\n{% endif %}\nAfter\n';

		expect(renderConditionalGroupBlocks(source, licensed(['finance']))).toBe('Before\nAfter\n');
	});

	it('matches the built-in All Users name', () => {
		const source = '{% if group("All Users") %}\nEveryone\n{% endif %}\n';

		expect(renderConditionalGroupBlocks(source, licensed(['All Users']))).toBe('Everyone\n');
	});

	it('supports nested and adjacent blocks', () => {
		const source = [
			'{% if group("finance") %}',
			'Finance',
			'{% if group("leaders") %}',
			'Finance leaders',
			'{% endif %}',
			'{% endif %}',
			'{% if group("marketing") %}',
			'Marketing',
			'{% endif %}',
			'{% if group("finance", "marketing") %}',
			'Shared',
			'{% endif %}',
			'',
		].join('\n');

		expect(renderConditionalGroupBlocks(source, licensed(['finance']))).toBe('Finance\nShared\n');
		expect(renderConditionalGroupBlocks(source, licensed(['finance', 'leaders']))).toBe(
			'Finance\nFinance leaders\nShared\n',
		);
	});

	it('preserves inline and fenced-code marker text verbatim', () => {
		const source = [
			'Use `{% if group("finance") %}` in an example.',
			'```jinja',
			'{% if group("finance") %}',
			'Example content',
			'{% endif %}',
			'```',
			'',
		].join('\n');

		expect(renderConditionalGroupBlocks(source, licensed([]))).toBe(source);
	});

	it('preserves ordinary line endings while removing complete directive and guarded lines', () => {
		const source = 'Before\r\n  {% if group("finance") %}  \r\nInside\r\n{% endif %}\r\nAfter';

		expect(renderConditionalGroupBlocks(source, licensed(['finance']))).toBe('Before\r\nInside\r\nAfter');
		expect(renderConditionalGroupBlocks(source, licensed([]))).toBe('Before\r\nAfter');
	});

	it('includes every valid block without exposing directives when unlicensed', () => {
		const source = 'Before\n{% if group("missing") %}\nVisible\n{% endif %}\nAfter\n';

		expect(renderConditionalGroupBlocks(source, unlicensed)).toBe('Before\nVisible\nAfter\n');
	});

	it('maps rendered lines back to source lines', () => {
		const source = 'Before\n{% if group("finance") %}\nFinance\n{% endif %}\nAfter\n';

		expect(renderConditionalGroupBlocksWithSourceLines(source, licensed(['finance']))).toEqual({
			content: 'Before\nFinance\nAfter\n',
			lines: [
				{ content: 'Before', sourceLineNumber: 1 },
				{ content: 'Finance', sourceLineNumber: 3 },
				{ content: 'After', sourceLineNumber: 5 },
			],
		});
	});

	it.each([
		['unmatched endif', 'Public\n{% endif %}\nGuarded'],
		['missing endif', 'Public\n{% if group("finance") %}\nGuarded'],
		['malformed group call', 'Public\n{% if group("finance" "marketing") %}\nGuarded\n{% endif %}'],
		['empty argument set', 'Public\n{% if group() %}\nGuarded\n{% endif %}'],
		['empty group name', 'Public\n{% if group("") %}\nGuarded\n{% endif %}'],
		['unsupported conditional', 'Public\n{% if user.is_admin %}\nGuarded\n{% endif %}'],
	])('fails closed for %s', (_name, source) => {
		expect(() => renderConditionalGroupBlocks(source, licensed(['finance']))).toThrow();
		expect(() => renderConditionalGroupBlocks(source, unlicensed)).toThrow();
	});
});

describe('isRootRulesPath', () => {
	it.each(['RULES.md', '/RULES.md', '.\\RULES.md', '//./RULES.md'])('accepts root path %s', (filePath) => {
		expect(isRootRulesPath(filePath)).toBe(true);
	});

	it.each(['/nested/RULES.md', 'docs\\RULES.md', '/rules.md', 'docs/../RULES.md'])(
		'rejects non-root path %s',
		(filePath) => {
			expect(isRootRulesPath(filePath)).toBe(false);
		},
	);
});
