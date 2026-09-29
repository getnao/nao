import { describe, expect, it } from 'vitest';

import { buildStoryApp } from '../src/services/story-app-build';

describe('buildStoryApp entry', () => {
	it('builds an entry that default-exports a component', async () => {
		const result = await buildStoryApp([
			{ path: 'app.jsx', content: 'export default function App() { return null; }' },
		]);

		expect(result.ok).toBe(true);
	});

	it('refuses an entry without a default export', async () => {
		const result = await buildStoryApp([{ path: 'app.jsx', content: 'export const App = () => null;' }]);

		expect(result).toEqual({
			ok: false,
			errors: [expect.stringContaining('must default-export the root React component')],
		});
	});

	it('refuses a non-script entry named in nao.json', async () => {
		const result = await buildStoryApp([
			{ path: 'nao.json', content: '{"entry": "styles.css"}' },
			{ path: 'styles.css', content: 'body { color: red; }' },
		]);

		expect(result).toEqual({
			ok: false,
			errors: [expect.stringContaining('must be a .jsx, .tsx, .js or .ts file')],
		});
	});
});
