import type { story } from '@nao/shared/tools';

import { Block, List, ListItem, Span } from '../../lib/markdown';

export type StoryModelOutput = story.Output & {
	_stale?: boolean;
	_editedByUser?: boolean;
};

export function StoryOutput({ output }: { output: StoryModelOutput }) {
	if (output.error) {
		return <Block>Story error: {output.error}</Block>;
	}

	if (output._stale) {
		return (
			<Block>
				Story "{output.title}" ({output.id}) — older invocation, see the latest version in a more recent tool
				result.
			</Block>
		);
	}

	const templateWarnings = output.template_warnings ?? [];

	return (
		<Block>
			Story "{output.title}" (v{output.version}) — {output.id}
			{output._editedByUser && (
				<Block>
					Note: This story was modified by the user since your last update. The content below reflects the
					current version. Base any further changes on this content.
				</Block>
			)}
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
