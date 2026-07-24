import { buildMapPoints, MAX_MAP_POINTS, resolveColumnName } from '@nao/shared';
import { displayMap } from '@nao/shared/tools';

import { DisplayMapOutput, renderToModelOutput } from '../../components/tool-outputs';
import { getQueryResult } from '../../services/query-result.service';
import { createTool } from '../../utils/tools';

export default createTool<displayMap.Input, displayMap.Output>({
	description:
		'Display an interactive map of geographic data from a previous `execute_sql` tool call. The query result must contain latitude and longitude columns in decimal degrees.',
	inputSchema: displayMap.InputSchema,
	outputSchema: displayMap.OutputSchema,

	execute: async (input, context) => {
		const queryResult = await getQueryResult(context, input.query_id);
		if (!queryResult) {
			return {
				_version: '1',
				success: false,
				error: `Query result "${input.query_id}" not found. Run \`execute_sql\` first and use the id from its output.`,
			};
		}

		const latitudeColumn = resolveColumnName(queryResult.columns, input.latitude_key);
		const longitudeColumn = resolveColumnName(queryResult.columns, input.longitude_key);
		const missingColumn = [latitudeColumn, longitudeColumn].find((column) => !queryResult.columns.includes(column));
		if (missingColumn) {
			return {
				_version: '1',
				success: false,
				error: `Column "${missingColumn}" not found in the query result. Available columns: ${queryResult.columns.join(', ')}.`,
			};
		}
		if (latitudeColumn === longitudeColumn) {
			return {
				_version: '1',
				success: false,
				error: 'latitude_key and longitude_key must reference different columns.',
			};
		}

		const points = buildMapPoints(queryResult.data, {
			...input,
			latitude_key: latitudeColumn,
			longitude_key: longitudeColumn,
		});
		if (points.length === 0) {
			return {
				_version: '1',
				success: false,
				error: 'The query result contains no rows with valid decimal-degree coordinates, so there is nothing to plot.',
			};
		}

		const warnings: string[] = [];
		const missingPopupKeys = [input.label_key, ...(input.tooltip_keys ?? [])]
			.filter((key): key is string => !!key)
			.filter((key) => !queryResult.columns.includes(resolveColumnName(queryResult.columns, key)));
		if (missingPopupKeys.length > 0) {
			warnings.push(
				`Popup column(s) ${missingPopupKeys.map((key) => `"${key}"`).join(', ')} not found in the query result, so popups will not show them. Available columns: ${queryResult.columns.join(', ')}.`,
			);
		}
		if (points.length > MAX_MAP_POINTS) {
			warnings.push(
				`The map only renders the first ${MAX_MAP_POINTS} points — mention this to the user, or aggregate in SQL to stay under the limit.`,
			);
		}

		return {
			_version: '1',
			success: true,
			point_count: points.length,
			dropped_row_count: queryResult.data.length - points.length,
			...(warnings.length > 0 && { warning: warnings.join(' ') }),
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayMapOutput({ output }), output),
});
