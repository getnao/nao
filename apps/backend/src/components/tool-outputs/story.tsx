import type { story } from '@nao/shared/tools';

import { Block, List, ListItem, Span } from '../../lib/markdown';
import { toStoryLibraryVirtualPath } from '../../utils/story-library';
import { CHAT_ARTIFACTS_TAG } from '../ai/chat-artifacts-prompt';
import { REFERENCED_STORY_TAG } from '../ai/referenced-story-prompt';

export type StoryModelOutput = story.Output & {
	/** Set on persisted outputs: the conversation artifacts carry the story's current content. */
	_stale?: boolean;
	/** Set with `_stale`: whether the conversation artifacts hold the story. */
	_inArtifacts?: boolean;
};

export function StoryOutput({ output }: { output: StoryModelOutput }) {
	const storyId = output.story_id ?? output.id;

	if (output.error) {
		return (
			<Block>
				Story error: {output.error}
				{output.build_errors && output.build_errors.length > 0 && (
					<Block>
						<Span>
							Build errors (fix these in /stories/{storyId}/ with the write tool, then publish again):
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
				Story "{output.title}" ({storyId}) — v{output.version} at the time.{' '}
				{describeCurrentContent(output, storyId)}
			</Block>
		);
	}

	if (output.format === 'custom') {
		return <CustomStoryOutput output={output} storyId={storyId} />;
	}

	const templateWarnings = output.template_warnings ?? [];

	return (
		<Block>
			Story "{output.title}" (v{output.version}) — {storyId}
			{output.story_chat_id && <Span>{ANOTHER_CHAT_STORY_NOTE}</Span>}
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

const ANOTHER_CHAT_STORY_NOTE = 'It belongs to another conversation.';

function describeCurrentContent(output: StoryModelOutput, storyId: string): string {
	if (output.story_chat_id) {
		return `It belongs to another conversation: its current content is in its <${REFERENCED_STORY_TAG}> block when the user references it, and under ${toStoryLibraryVirtualPath(storyId)}/.`;
	}
	if (output._inArtifacts) {
		return `Its current content is in the <${CHAT_ARTIFACTS_TAG}> block of the latest user message.`;
	}
	return 'It is no longer part of this conversation.';
}

function CustomStoryOutput({ output, storyId }: { output: StoryModelOutput; storyId: string }) {
	const files = output.files ?? [];
	const state = output.version > 0 ? `published v${output.version}` : 'draft, not published yet';

	return (
		<Block>
			{output.message && <Block>{output.message}</Block>}
			Custom story "{output.title}" ({storyId}) — {state}. Files under /stories/{storyId}/:
			{files.length === 0 ? (
				<Block>(no files yet — add them with the write tool, then "publish")</Block>
			) : (
				<List>
					{files.map((file) => (
						<ListItem key={file}>{file}</ListItem>
					))}
				</List>
			)}
			{output.story_chat_id && <Span>{ANOTHER_CHAT_STORY_NOTE}</Span>}
		</Block>
	);
}
