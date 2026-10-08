import type { story } from '@nao/shared/tools';

import { Block, List, ListItem, Span } from '../../lib/markdown';
import { CHAT_ARTIFACTS_TAG } from '../ai/chat-artifacts-prompt';

export type StoryModelOutput = story.Output & {
	/** Set on persisted outputs: the conversation artifacts carry the story's current content. */
	_stale?: boolean;
};

export function StoryOutput({ output }: { output: StoryModelOutput }) {
	if (output.error) {
		return (
			<Block>
				Story error: {output.error}
				{output.build_errors && output.build_errors.length > 0 && (
					<Block>
						<Span>
							Build errors (fix these in /stories/{output.id}/ with the write tool, then publish again):
						</Span>
						<List>
							{output.build_errors.map((buildError) => (
								<ListItem key={buildError}>{buildError}</ListItem>
							))}
						</List>
					</Block>
				)}
			</Block>
		);
	}

	if (output._stale) {
		return (
			<Block>
				Story "{output.title}" ({output.id}) — v{output.version} at the time. Its current content is in the{' '}
				{`<${CHAT_ARTIFACTS_TAG}>`} block of the latest user message.
			</Block>
		);
	}

	if (output.format === 'custom') {
		return <CustomStoryOutput output={output} />;
	}

	const templateWarnings = output.template_warnings ?? [];

	return (
		<Block>
			Story "{output.title}" (v{output.version}) — {output.id}
			{templateWarnings.length > 0 && (
				<Block>
					<Span>
						Story filter template warnings — fix the referenced SQL with execute_sql (prefer query_id)
						and/or the story filter tags before considering this story complete:
					</Span>
					<List>
						{templateWarnings.map((warning) => (
							<ListItem key={warning}>{warning}</ListItem>
						))}
					</List>
				</Block>
			)}
			<Block>{output.code}</Block>
		</Block>
	);
}

function CustomStoryOutput({ output }: { output: StoryModelOutput }) {
	const files = output.files ?? [];
	const state = output.version > 0 ? `published v${output.version}` : 'draft, not published yet';

	return (
		<Block>
			{output.message && <Block>{output.message}</Block>}
			Custom story "{output.title}" ({output.id}) — {state}. Files under /stories/{output.id}/:
			{files.length === 0 ? (
				<Block>(no files yet — add them with the write tool, then "publish")</Block>
			) : (
				<List>
					{files.map((file) => (
						<ListItem key={file}>{file}</ListItem>
					))}
				</List>
			)}
		</Block>
	);
}
