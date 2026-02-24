import type { story } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';

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

	return (
		<Block>
			Story "{output.title}" (v{output.version}) — {output.id}
			{output._editedByUser && (
				<Block>
					Note: This story was modified by the user since your last update. The content below reflects the
					current version. Base any further changes on this content.
				</Block>
			)}
			<Block>{output.code}</Block>
		</Block>
	);
}
