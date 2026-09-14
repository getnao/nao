import type { parseTableauFilters } from '@nao/shared/tools';
import { type CheerioAPI, load } from 'cheerio';
import type { Element } from 'domhandler';

import { parseTableauWorkbookXml, readWorkbookXml } from './tableau-workbook';

type FilterSelection = {
	worksheet?: string;
	dashboard?: string;
};
const MAX_DEFINITION_BYTES = 32 * 1024 * 1024;

export const parseTableauFiltersBytes = (
	data: Buffer,
	selection: FilterSelection = {},
): parseTableauFilters.FilterDefinition => {
	return parseTableauFiltersXml(readWorkbookXml(data), selection);
};

export const parseTableauFiltersXml = (
	xml: string,
	selection: FilterSelection = {},
): parseTableauFilters.FilterDefinition => {
	if (Buffer.byteLength(xml) > MAX_DEFINITION_BYTES) {
		throw new Error('The Tableau workbook definition exceeds the 32 MB parsing limit.');
	}

	const $ = load(xml, { xmlMode: true });
	if ($('workbook').length === 0) {
		throw new Error('This file does not contain a Tableau <workbook> definition.');
	}

	const warnings: string[] = [];
	const selectedWorksheets = selectWorksheetNames($, xml, selection);
	const filters = $('worksheet')
		.toArray()
		.filter((worksheet) => selectedWorksheets.has(attribute(worksheet, 'name')))
		.flatMap((worksheet) => extractCategoricalFilters($, worksheet, warnings));
	const controls = selection.worksheet ? [] : extractFilterControls(xml, selection.dashboard, filters, warnings);

	if ($('zone[type-v2="paramctrl"], zone[type="paramctrl"]').length > 0) {
		warnings.push('Tableau parameters are not supported by this categorical-filter parser.');
	}

	return { filters, parameters: [], controls, warnings: unique(warnings) };
};

const selectWorksheetNames = ($: CheerioAPI, xml: string, selection: FilterSelection): Set<string> => {
	const names = $('worksheet')
		.toArray()
		.map((worksheet) => attribute(worksheet, 'name'))
		.filter(Boolean);
	if (selection.worksheet) {
		const match = names.find((name) => normalize(name) === normalize(selection.worksheet ?? ''));
		if (!match) {
			throw new Error(
				`No worksheet named "${selection.worksheet}" was found. Available worksheets: ${names.join(', ') || 'none'}.`,
			);
		}
		return new Set([match]);
	}
	if (selection.dashboard) {
		return new Set(parseTableauWorkbookXml(xml, selection.dashboard).dashboards[0]?.worksheets ?? []);
	}
	return new Set(names);
};

const extractCategoricalFilters = (
	$: CheerioAPI,
	worksheet: Element,
	warnings: string[],
): parseTableauFilters.FilterDefinition['filters'] => {
	const worksheetName = attribute(worksheet, 'name');
	return $(worksheet)
		.find('filter')
		.toArray()
		.flatMap((filter) => {
			const field = attribute(filter, 'column');
			const filterType = (attribute(filter, 'class') || attribute(filter, 'type')).toLowerCase();
			if (!field) {
				warnings.push(`${worksheetName} contains a filter without a field reference; it was skipped.`);
				return [];
			}
			if (filterType !== 'categorical') {
				warnings.push(`${worksheetName} filter ${field} uses unsupported type "${filterType}".`);
				return [];
			}

			const functions = $(filter)
				.find('groupfilter')
				.toArray()
				.map((node) => attribute(node, 'function').toLowerCase());
			const values = unique(
				$(filter)
					.find('groupfilter[member]')
					.toArray()
					.map((node) => cleanValue(attribute(node, 'member')))
					.filter(Boolean),
			);
			if (values.length === 0) {
				warnings.push(`${worksheetName} categorical filter ${field} has no explicit member values.`);
			}

			return [
				{
					field,
					caption: displayFieldName(field),
					data_source: bracketedParts(field)[0],
					filter_type: filterType,
					context: ['context', 'is-context', 'context-filter'].some((name) =>
						['1', 'true', 'yes'].includes(attribute(filter, name).toLowerCase()),
					),
					mode: functions.some((value) => value === 'except' || value === 'exclude')
						? ('exclude' as const)
						: ('include' as const),
					values,
					target_worksheets: [worksheetName],
					raw_expression: $(filter).toString(),
				},
			];
		});
};

const extractFilterControls = (
	xml: string,
	dashboardName: string | undefined,
	filters: parseTableauFilters.FilterDefinition['filters'],
	warnings: string[],
): parseTableauFilters.FilterDefinition['controls'] => {
	return parseTableauWorkbookXml(xml, dashboardName).dashboards.flatMap((dashboard) =>
		dashboard.controls.flatMap((control) => {
			if (control.type !== 'filter') {
				return [];
			}
			const matches = filters.filter(
				(filter) =>
					(!control.field || displayFieldName(filter.field) === displayFieldName(control.field)) &&
					filter.target_worksheets.some((worksheet) => dashboard.worksheets.includes(worksheet)),
			);
			if (matches.length === 0) {
				warnings.push(
					`${dashboard.name} filter control ${control.field ?? '(unknown field)'} has no matching categorical filter.`,
				);
				return [];
			}
			return [
				{
					type: 'filter' as const,
					dashboard: dashboard.name,
					field: control.field,
					source_worksheet: control.worksheet,
					target_worksheets: unique(matches.flatMap((filter) => filter.target_worksheets)),
				},
			];
		}),
	);
};

const bracketedParts = (value: string): string[] =>
	[...value.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1] ?? '').filter(Boolean);

const displayFieldName = (value: string): string => {
	const raw = bracketedParts(value).at(-1) ?? value;
	const parts = raw.split(':');
	return (parts.length >= 3 ? parts.slice(1, -1).join(':') : raw).trim();
};

const cleanValue = (value: string): string => value.replace(/^"(.*)"$/, '$1').trim();
const attribute = (node: Element | undefined, name: string): string => node?.attribs[name]?.trim() ?? '';
const normalize = (value: string): string => value.toLowerCase().replace(/[\s_-]+/g, '');
const unique = <T>(values: T[]): T[] => [...new Set(values)];
