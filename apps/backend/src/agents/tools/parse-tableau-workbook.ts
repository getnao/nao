import { parseTableauWorkbook } from '@nao/shared/tools';

import { parseTableauWorkbookBytes } from '../../services/tableau-workbook';
import { readTableauWorkbookInput } from '../../services/tableau-workbook-input';
import { createTool } from '../../utils/tools';

export default createTool<parseTableauWorkbook.Input, parseTableauWorkbook.Output>({
	description: parseTableauWorkbook.description,
	inputSchema: parseTableauWorkbook.InputSchema,
	outputSchema: parseTableauWorkbook.OutputSchema,
	execute: async ({ file_path, workbook_xml, workbook_base64, dashboard }, context) => {
		if ([file_path, workbook_xml, workbook_base64].filter(Boolean).length !== 1) {
			return {
				_version: '1',
				success: false,
				error: 'Provide exactly one of file_path, workbook_xml, or workbook_base64.',
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
				workbook: parseTableauWorkbookBytes(bytes, dashboard),
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
