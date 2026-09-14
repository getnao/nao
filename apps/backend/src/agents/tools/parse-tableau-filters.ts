import { parseTableauFilters } from '@nao/shared/tools';

import { parseTableauFiltersBytes } from '../../services/tableau-filters';
import { readTableauWorkbookInput } from '../../services/tableau-workbook-input';
import { createTool } from '../../utils/tools';

export default createTool<parseTableauFilters.Input, parseTableauFilters.Output>({
	description: parseTableauFilters.description,
	inputSchema: parseTableauFilters.InputSchema,
	outputSchema: parseTableauFilters.OutputSchema,
	execute: async ({ file_path, workbook_xml, workbook_base64, worksheet, dashboard }, context) => {
		if ([file_path, workbook_xml, workbook_base64].filter(Boolean).length !== 1) {
			return {
				_version: '1',
				success: false,
				error: 'Provide exactly one of file_path, workbook_xml, or workbook_base64.',
			};
		}

		if (worksheet && dashboard) {
			return {
				_version: '1',
				success: false,
				error: 'Provide only one of worksheet or dashboard.',
			};
		}

		try {
			const bytes = await readTableauWorkbookInput(
				{
					filePath: file_path,
					workbookXml: workbook_xml,
					workbookBase64: workbook_base64,
				},
				context,
			);

			return {
				_version: '1',
				success: true,
				definition: parseTableauFiltersBytes(bytes, { worksheet, dashboard }),
			};
		} catch (error) {
			return {
				_version: '1',
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
});
