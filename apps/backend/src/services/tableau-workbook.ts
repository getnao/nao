import type { parseTableauWorkbook } from '@nao/shared/tools';
import { type CheerioAPI, load } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { unzipSync } from 'fflate';

const MAX_DEFINITION_BYTES = 32 * 1024 * 1024;
const NON_WORKSHEET_ZONE_TYPES = new Set([
	'color',
	'dashboard-object',
	'empty',
	'filter',
	'layout-basic',
	'layout-flow',
	'legend',
	'paramctrl',
	'text',
	'title',
	'web',
]);

export const parseTableauWorkbookBytes = (
	data: Buffer,
	dashboard?: string,
): parseTableauWorkbook.WorkbookComposition => {
	return parseTableauWorkbookXml(readWorkbookXml(data), dashboard);
};

export const parseTableauWorkbookXml = (xml: string, dashboard?: string): parseTableauWorkbook.WorkbookComposition => {
	if (Buffer.byteLength(xml) > MAX_DEFINITION_BYTES) {
		throw new Error('The Tableau workbook definition exceeds the 32 MB parsing limit.');
	}

	const $ = load(xml, { xmlMode: true });
	const workbook = elements($).find((node) => localName(node) === 'workbook');
	if (!workbook) {
		throw new Error('This file does not contain a Tableau <workbook> definition.');
	}

	const worksheets = sectionChildren(workbook, 'worksheets', 'worksheet')
		.map((node) => attribute(node, 'name'))
		.filter(Boolean);
	const worksheetNames = new Set(worksheets);
	const allDashboards = sectionChildren(workbook, 'dashboards', 'dashboard').map((node) =>
		parseDashboard($, node, worksheetNames),
	);
	const dashboards = selectDashboards(allDashboards, dashboard);
	const selectedWorksheets = new Set(dashboards.flatMap((entry) => entry.worksheets));
	const placedWorksheets = new Set(allDashboards.flatMap((entry) => entry.worksheets));

	return {
		worksheets,
		dashboards,
		skipped_worksheets: worksheets.filter((name) =>
			dashboard ? !selectedWorksheets.has(name) : !placedWorksheets.has(name),
		),
		warnings: buildWarnings(allDashboards, worksheetNames),
	};
};

export const readWorkbookXml = (data: Buffer): string => {
	if (!isZip(data)) {
		return data.toString('utf8');
	}

	const files = unzipSync(new Uint8Array(data), {
		filter: ({ name, originalSize }) =>
			name.toLowerCase().endsWith('.twb') &&
			!name.split('/').some((part) => part.toLowerCase() === 'data') &&
			originalSize <= MAX_DEFINITION_BYTES,
	});
	const workbookPath = Object.keys(files).sort((left, right) => {
		return left.split('/').length - right.split('/').length || left.localeCompare(right);
	})[0];
	if (!workbookPath) {
		throw new Error('No .twb definition was found inside this .twbx archive.');
	}
	return new TextDecoder().decode(files[workbookPath]);
};

const parseDashboard = (
	$: CheerioAPI,
	dashboard: Element,
	worksheetNames: Set<string>,
): parseTableauWorkbook.Dashboard => {
	const size = descendants($, dashboard).find(
		(node) => localName(node) === 'size' && !closestAncestor(node, 'devicelayout'),
	);
	const zoneNodes = descendants($, dashboard).filter(
		(node) => localName(node) === 'zone' && !closestAncestor(node, 'devicelayout'),
	);
	const ids = new Map(zoneNodes.map((zone, index) => [zone, attribute(zone, 'id') || `zone-${index + 1}`]));
	const worksheetZones = zoneNodes.filter((zone) => worksheetName(zone, worksheetNames));

	return {
		name: attribute(dashboard, 'name'),
		width: numberAttribute(size, 'width') ?? numberAttribute(size, 'maxwidth'),
		height: numberAttribute(size, 'height') ?? numberAttribute(size, 'maxheight'),
		worksheets: unique(worksheetZones.map((zone) => worksheetName(zone, worksheetNames)).filter(Boolean)),
		layout_rows: layoutRows(worksheetZones, worksheetNames),
		zones: zoneNodes.map((zone) => {
			const parent = closestAncestor(zone, 'zone');
			const parameter = attribute(zone, 'param');
			return compact({
				id: ids.get(zone) ?? '',
				parent_id: parent ? ids.get(parent) : undefined,
				type: zoneType(zone) || undefined,
				name: attribute(zone, 'name') || undefined,
				worksheet: worksheetName(zone, worksheetNames) || undefined,
				x: numberAttribute(zone, 'x'),
				y: numberAttribute(zone, 'y'),
				width: numberAttribute(zone, 'w'),
				height: numberAttribute(zone, 'h'),
				flow_direction:
					parameter === 'horz'
						? ('horizontal' as const)
						: parameter === 'vert'
							? ('vertical' as const)
							: undefined,
				floating: booleanAttribute(zone, 'fixed-item'),
			});
		}),
		controls: zoneNodes.flatMap((zone) => {
			const type = zoneType(zone);
			if (type !== 'filter' && type !== 'paramctrl') {
				return [];
			}
			return [
				compact({
					type: type === 'filter' ? ('filter' as const) : ('parameter' as const),
					field: attribute(zone, 'param') || undefined,
					worksheet: worksheetNames.has(attribute(zone, 'name')) ? attribute(zone, 'name') : undefined,
				}),
			];
		}),
	};
};

const worksheetName = (zone: Element, worksheetNames: Set<string>): string => {
	const name = attribute(zone, 'name');
	if (!name || !worksheetNames.has(name) || NON_WORKSHEET_ZONE_TYPES.has(zoneType(zone))) {
		return '';
	}
	return name;
};

const zoneType = (zone: Element): string => {
	return (attribute(zone, 'type-v2') || attribute(zone, 'type')).toLowerCase();
};

const layoutRows = (zones: Element[], worksheetNames: Set<string>): string[][] => {
	const positioned = zones
		.map((zone, index) => ({
			name: worksheetName(zone, worksheetNames),
			x: numberAttribute(zone, 'x') ?? index,
			y: numberAttribute(zone, 'y'),
			index,
		}))
		.sort((left, right) => (left.y ?? left.index) - (right.y ?? right.index) || left.x - right.x);
	const rows = new Map<string, typeof positioned>();
	for (const zone of positioned) {
		const key = zone.y === undefined ? `unknown-${zone.index}` : String(zone.y);
		rows.set(key, [...(rows.get(key) ?? []), zone]);
	}
	return [...rows.values()].map((row) => row.sort((left, right) => left.x - right.x).map((zone) => zone.name));
};

const selectDashboards = (
	dashboards: parseTableauWorkbook.Dashboard[],
	requested?: string,
): parseTableauWorkbook.Dashboard[] => {
	if (!requested) {
		return dashboards;
	}
	const match = dashboards.find((dashboard) => normalize(dashboard.name) === normalize(requested));
	if (!match) {
		const available = dashboards.map((dashboard) => dashboard.name).join(', ') || 'none';
		throw new Error(`No dashboard named "${requested}" was found. Available dashboards: ${available}.`);
	}
	return [match];
};

const buildWarnings = (dashboards: parseTableauWorkbook.Dashboard[], worksheetNames: Set<string>): string[] => {
	const warnings = dashboards.flatMap((dashboard) =>
		dashboard.zones.flatMap((zone: parseTableauWorkbook.Dashboard['zones'][number]) => {
			if ((zone.type === 'worksheet' || zone.type === 'sheet') && zone.name && !worksheetNames.has(zone.name)) {
				return [`${dashboard.name} references missing worksheet ${zone.name}.`];
			}
			if (zone.worksheet && (zone.x === undefined || zone.y === undefined)) {
				return [`${dashboard.name} has incomplete worksheet coordinates; its layout_rows are approximate.`];
			}
			return [];
		}),
	);
	return dashboards.length === 0 ? ['The workbook contains no dashboards.', ...warnings] : warnings;
};

const sectionChildren = (root: Element, section: string, child: string): Element[] => {
	const container = directChildren(root).find((node) => localName(node) === section);
	return container ? directChildren(container).filter((node) => localName(node) === child) : [];
};

const elements = ($: CheerioAPI): Element[] => {
	return $('*')
		.toArray()
		.filter((node): node is Element => node.type === 'tag');
};

const descendants = ($: CheerioAPI, root: Element): Element[] => {
	return $(root)
		.find('*')
		.toArray()
		.filter((node): node is Element => node.type === 'tag');
};

const directChildren = (node: Element): Element[] => {
	return node.children.filter((child): child is Element => child.type === 'tag');
};

const closestAncestor = (node: Element, name: string): Element | undefined => {
	let parent: AnyNode | null = node.parent;
	while (parent) {
		if (parent.type === 'tag' && localName(parent) === name) {
			return parent;
		}
		parent = parent.parent;
	}
	return undefined;
};

const localName = (node: Element): string => node.name.replace(/^.*:/, '').toLowerCase();
const attribute = (node: Element | undefined, name: string): string => node?.attribs[name]?.trim() ?? '';

const numberAttribute = (node: Element | undefined, name: string): number | undefined => {
	const value = Number(attribute(node, name));
	return Number.isFinite(value) && attribute(node, name) !== '' ? value : undefined;
};

const booleanAttribute = (node: Element | undefined, name: string): boolean | undefined => {
	const value = attribute(node, name).toLowerCase();
	return value ? ['1', 'true', 'yes'].includes(value) : undefined;
};

const isZip = (data: Buffer): boolean =>
	data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;

const normalize = (value: string): string => value.toLowerCase().replace(/[\s_-]+/g, '');
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const compact = <T extends Record<string, unknown>>(value: T): T =>
	Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
