import type { displayMap } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';

export function DisplayMapOutput({ output }: { output: displayMap.Output }) {
	if (output.error) {
		return <Block>Could not display the map: {output.error}</Block>;
	}
	const points = output.point_count != null ? ` with ${output.point_count} point(s)` : '';
	const dropped = output.dropped_row_count
		? ` ${output.dropped_row_count} row(s) were dropped for missing or invalid coordinates — adjust the SQL if they should appear.`
		: '';
	const warning = output.warning ? ` Warning: ${output.warning}` : '';
	return (
		<Block>
			Map displayed successfully{points}.{dropped}
			{warning}
		</Block>
	);
}
