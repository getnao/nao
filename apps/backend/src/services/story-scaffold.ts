import { STORY_APP_MANIFEST_PATH } from '@nao/shared/story-app';

import type { StoryFileInput } from '../queries/story-file.queries';

const SCAFFOLD_ENTRY_PATH = 'app.jsx';
const SCAFFOLD_STYLES_PATH = 'app.css';

/** An empty draft becomes the story-kit starter app; files the agent wrote itself are kept as they are. */
export function scaffoldCustomStoryFiles(title: string, files: StoryFileInput[]): StoryFileInput[] {
	if (files.length > 0) {
		return files;
	}
	return [
		{ path: STORY_APP_MANIFEST_PATH, content: `${JSON.stringify({ entry: SCAFFOLD_ENTRY_PATH }, null, 2)}\n` },
		{ path: SCAFFOLD_ENTRY_PATH, content: starterApp(title) },
		{ path: SCAFFOLD_STYLES_PATH, content: STARTER_STYLES },
	];
}

function starterApp(title: string): string {
	return `import { BarChart, DataTable, KpiCard, LineChart, Narrative } from "@nao/story-kit";

// Starter layout, nothing here is wired to data yet: replace every REPLACE_ME with the id
// of a query you ran with execute_sql in this chat, rename the titles, add format/xKey/series
// where the inferred ones are wrong, and drop the blocks you do not need.
export default function App() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>${jsxText(title)}</h1>
        <p>
          <Narrative id="summary">One sentence on what this story answers.</Narrative>
        </p>
      </header>

      <section className="grid grid--3">
        <KpiCard title="Headline metric" queryId="REPLACE_ME" />
        <KpiCard title="Second metric" queryId="REPLACE_ME" />
        <KpiCard title="Third metric" queryId="REPLACE_ME" />
      </section>

      <LineChart title="Trend over time" queryId="REPLACE_ME" />

      <section className="grid grid--2">
        <BarChart title="Breakdown" queryId="REPLACE_ME" />
        <DataTable title="Details" queryId="REPLACE_ME" maxRows={10} />
      </section>
    </main>
  );
}
`;
}

const STARTER_STYLES = `.page {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page__header h1 {
  font-size: calc(var(--story-body-size) * var(--story-heading-scale) * 1.6);
  line-height: 1.2;
}

.page__header p {
  margin: 4px 0 0;
  color: var(--muted-foreground);
}

.grid {
  display: grid;
  gap: 16px;
}

.grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 720px) {
  .grid--2,
  .grid--3 {
    grid-template-columns: 1fr;
  }
}
`;

function jsxText(value: string): string {
	return value.replaceAll(/[{}<>&]/g, (char) => `{${JSON.stringify(char)}}`);
}
