import { describe, expect, it } from 'vitest';

import { applyKitBlockChange, parseKitSource } from '../src/utils/story-kit-jsx';

const SOURCE = `import { KpiCard } from '@nao/story-kit';

export default function App() {
	return <KpiCard queryId="query_1" title="Revenue" format="currency" />;
}
`;

function editFirstBlock(change: { set: Record<string, unknown>; unset: string[] }): string {
	const kitSource = parseKitSource('app.jsx', SOURCE)!;
	return applyKitBlockChange(SOURCE, kitSource, kitSource.elements[0], change);
}

describe('applyKitBlockChange', () => {
	it('replaces a prop that is both unset and set instead of corrupting the element', () => {
		const edited = editFirstBlock({ set: { title: 'Sales' }, unset: ['title'] });

		expect(edited).toContain('<KpiCard queryId="query_1" title="Sales" format="currency" />');
	});

	it('still removes props that are only unset', () => {
		const edited = editFirstBlock({ set: {}, unset: ['format'] });

		expect(edited).toContain('<KpiCard queryId="query_1" title="Revenue" />');
	});
});
