import type { displayTable } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';

export function DisplayTableOutput({ output }: { output: displayTable.Output }) {
	if (output.error) {
		return <Block>Could not display the table: {output.error}</Block>;
	}
	return <Block>Table displayed successfully.</Block>;
}
