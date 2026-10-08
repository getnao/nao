import { Block, List, ListItem, Span, Title } from '../../lib/markdown';
import type { ChatArtifacts, QueryArtifact, StoryArtifact } from '../../types/artifacts';

export const CHAT_ARTIFACTS_TAG = 'conversation-artifacts';

export function ChatArtifactsPrompt({ artifacts }: { artifacts: ChatArtifacts }) {
	return (
		<Block>
			<Span>{`<${CHAT_ARTIFACTS_TAG}>`}</Span>
			<Span>
				Queries and stories produced earlier in this conversation, at their current state. This list is rebuilt
				on every turn and stays available when older messages are summarized: refer to these exact ids, never
				guess or invent one.
			</Span>
			{artifacts.queries.length > 0 && <QueriesSection queries={artifacts.queries} />}
			{artifacts.stories.length > 0 && <StoriesSection stories={artifacts.stories} />}
			<Span>{`</${CHAT_ARTIFACTS_TAG}>`}</Span>
		</Block>
	);
}

function QueriesSection({ queries }: { queries: QueryArtifact[] }) {
	return (
		<Block>
			<Title>Queries</Title>
			<List>
				{queries.map((query) => (
					<ListItem key={query.id}>{describeQuery(query)}</ListItem>
				))}
			</List>
			<Span>
				Reuse these ids as they are in display_chart and in story chart/table blocks. A new question or metric
				needs a new execute_sql call, which returns a new id. Pass query_id to execute_sql only to fix or refine
				the SQL of a query a chart or table already displays, keeping the same result shape.
			</Span>
		</Block>
	);
}

function describeQuery(query: QueryArtifact): string {
	const title = query.title ? ` — ${query.title}` : '';
	const rows = `${query.rowCount} ${query.rowCount === 1 ? 'row' : 'rows'}`;
	return `${query.id}${title} — ${rows} — columns: ${query.columns.join(', ')}`;
}

function StoriesSection({ stories }: { stories: StoryArtifact[] }) {
	return (
		<Block>
			<Title>Stories</Title>
			<Span>
				The current content of each story, including edits the user made directly. Base any "update" search
				string on this content.
			</Span>
			{stories.map((story) => (
				<StoryBlock key={story.id} story={story} />
			))}
		</Block>
	);
}

/** The code is emitted verbatim, without indentation, so an "update" search string matches it. */
function StoryBlock({ story }: { story: StoryArtifact }) {
	const attributes = [
		`id=${JSON.stringify(story.id)}`,
		`title=${JSON.stringify(story.title)}`,
		`version="${story.version}"`,
		`format=${JSON.stringify(story.format)}`,
	].join(' ');
	return (
		<Block separator={'\n'}>
			<Span>{`<story ${attributes}>`}</Span>
			{story.editedByUser && (
				<Span>
					Note: the user modified this story since your last update. Base further changes on this content.
				</Span>
			)}
			{story.templateWarnings.length > 0 && <TemplateWarnings warnings={story.templateWarnings} />}
			{story.format === 'custom' ? <CustomStoryFiles story={story} /> : story.code}
			<Span>{`</story>`}</Span>
		</Block>
	);
}

function TemplateWarnings({ warnings }: { warnings: string[] }) {
	return (
		<Block separator={'\n'}>
			<Span>
				Story filter template warnings — fix the referenced SQL with execute_sql (prefer query_id) and/or the
				story filter tags:
			</Span>
			<List>
				{warnings.map((warning) => (
					<ListItem key={warning}>{warning}</ListItem>
				))}
			</List>
		</Block>
	);
}

function CustomStoryFiles({ story }: { story: StoryArtifact }) {
	const state = story.version > 0 ? `published v${story.version}` : 'draft, not published yet';
	if (story.files.length === 0) {
		return (
			<Span>
				Custom story ({state}), no files yet under /stories/{story.id}/.
			</Span>
		);
	}
	return (
		<Block separator={'\n'}>
			<Span>
				Custom story ({state}). Draft files under /stories/{story.id}/, read them with the read tool:
			</Span>
			<List>
				{story.files.map((file) => (
					<ListItem key={file}>{file}</ListItem>
				))}
			</List>
		</Block>
	);
}
