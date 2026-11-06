import { describe, expect, it } from 'vitest';

import { appendKitBlock, applyKitBlockChange, parseKitSource, StoryKitJsxEditError } from '../src/utils/story-kit-jsx';

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

const PLUGIN_CHART = {
	component: 'Chart' as const,
	props: { queryId: 'query_2', type: 'ouistiti', title: 'Top customers', xKey: 'customer', series: ['total_paid'] },
};

describe('appendKitBlock', () => {
	it('adds the block at the end of the layout and imports its component', () => {
		const source = `import { KpiCard } from '@nao/story-kit';

export default function App() {
	return (
		<main className="page">
			<KpiCard queryId="query_1" title="Revenue" />
		</main>
	);
}
`;

		const appended = appendKitBlock('app.jsx', source, PLUGIN_CHART);

		expect(appended).toContain("import { KpiCard, Chart } from '@nao/story-kit';");
		expect(appended).toMatch(
			/<KpiCard queryId="query_1" title="Revenue" \/>\s*<Chart queryId="query_2" type="ouistiti" title="Top customers" xKey="customer" series=\{\["total_paid"\]\} \/>\s*<\/main>/,
		);
	});

	it('reuses an existing import and follows a default export declared elsewhere', () => {
		const source = `import { Chart } from '@nao/story-kit';

const App = () => <>
	<h1>Sales</h1>
</>;

export default App;
`;

		const appended = appendKitBlock('app.jsx', source, PLUGIN_CHART);

		expect(appended.match(/import/g)).toHaveLength(1);
		expect(appended).toMatch(/<h1>Sales<\/h1>\s*<Chart queryId="query_2"[^>]*\/>\s*<\/>/);
	});

	it('imports the component under an alias when the file already has a name of its own for it', () => {
		const source = `import { KpiCard } from '@nao/story-kit';

function Chart() {
	return <svg />;
}

export default function App() {
	return (
		<main>
			<Chart />
		</main>
	);
}
`;

		const appended = appendKitBlock('app.jsx', source, PLUGIN_CHART);

		expect(appended).toContain("import { KpiCard, Chart as KitChart } from '@nao/story-kit';");
		expect(appended).toMatch(/<Chart \/>\s*<KitChart queryId="query_2"[^>]*\/>\s*<\/main>/);
		expect(parseKitSource('app.jsx', appended)).not.toBeNull();
	});

	it('imports the kit when the file does not use it yet', () => {
		const source = 'export default function App() {\n\treturn <main></main>;\n}\n';

		const appended = appendKitBlock('app.jsx', source, PLUGIN_CHART);

		expect(appended.startsWith('import { Chart } from "@nao/story-kit";\n')).toBe(true);
	});

	it('gives the block a slide of its own in a deck', () => {
		const source = `import { Slide, Slides } from '@nao/story-kit';

export default function App() {
	return (
		<Slides>
			<Slide title="Intro">Hello</Slide>
		</Slides>
	);
}
`;

		const appended = appendKitBlock('app.jsx', source, PLUGIN_CHART);

		expect(appended).toContain("import { Slide, Slides, Chart } from '@nao/story-kit';");
		expect(appended).toMatch(
			/<Slide title="Top customers">\s*<Chart queryId="query_2"[^>]*\/>\s*<\/Slide>\s*<\/Slides>/,
		);
	});

	it('adds the slide inside a deck wrapped in a fragment', () => {
		const source = `import { Slide, Slides } from '@nao/story-kit';

export default function App() {
	return (
		<>
			<h1>Report</h1>
			<Slides>
				<Slide title="Intro">Hello</Slide>
			</Slides>
		</>
	);
}
`;

		const appended = appendKitBlock('app.jsx', source, PLUGIN_CHART);

		expect(appended).toMatch(
			/<Slide title="Top customers">\s*<Chart queryId="query_2"[^>]*\/>\s*<\/Slide>\s*<\/Slides>\s*<\/>/,
		);
	});

	it('refuses a layout it cannot find instead of guessing', () => {
		const source = "import { memo } from 'react';\n\nexport default memo(() => <main />);\n";

		expect(() => appendKitBlock('app.jsx', source, PLUGIN_CHART)).toThrow(StoryKitJsxEditError);
	});
});
