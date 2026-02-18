import type { artifact } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';

export function ArtifactOutput({ output }: { output: artifact.Output }) {
	if (output.error) {
		return <Block>Artifact error: {output.error}</Block>;
	}
	return (
		<Block>
			Artifact "{output.title}" (v{output.version}) — {output.id}
		</Block>
	);
}
