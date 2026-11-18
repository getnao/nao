import { DEFAULT_COLORS } from '@nao/shared';
import { type StoryTheme, type StoryThemePair, storyThemeToCssVars } from '@nao/shared/story-theme';

export interface StoryExportPalette {
	page: string;
	heading: string;
	subheading: string;
	body: string;
	muted: string;
	faint: string;
	border: string;
	strongBorder: string;
	sunken: string;
	popover: string;
	link: string;
	tableBackground: string;
	tableBorder: string;
	tableBorderWidth: number;
	tableHeaderBackground: string;
	tableHeaderText: string;
	tableDivider: string;
	series: string[];
	barRadius: number;
	bodyFont: string;
	headingFont: string;
	fontStylesheets: string[];
	cssVariables: Record<string, string>;
}

const SYSTEM_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

export const DEFAULT_EXPORT_PALETTE: StoryExportPalette = {
	page: '#ffffff',
	heading: '#111827',
	subheading: '#374151',
	body: 'rgba(0,0,0,0.85)',
	muted: '#6b7280',
	faint: '#9ca3af',
	border: '#e5e7eb',
	strongBorder: '#d1d5db',
	sunken: '#f3f4f6',
	popover: '#ffffff',
	link: '#4F46E5',
	tableBackground: 'rgba(255,255,255,0.5)',
	tableBorder: '#e5e7eb',
	tableBorderWidth: 1,
	tableHeaderBackground: '#fafafa',
	tableHeaderText: 'rgba(0,0,0,0.5)',
	tableDivider: 'rgba(0,0,0,0.05)',
	series: DEFAULT_COLORS,
	barRadius: 4,
	bodyFont: SYSTEM_FONT,
	headingFont: SYSTEM_FONT,
	fontStylesheets: [],
	cssVariables: {},
};

export function storyExportPalette(theme: StoryThemePair | null | undefined): StoryExportPalette {
	return theme ? paletteFromTheme(theme.light) : DEFAULT_EXPORT_PALETTE;
}

function paletteFromTheme(theme: StoryTheme): StoryExportPalette {
	const { 'color-scheme': _colorScheme, ...cssVariables } = storyThemeToCssVars(theme);
	return {
		page: theme.surfaces.page,
		heading: theme.text.headingColor,
		subheading: theme.text.headingColor,
		body: theme.text.bodyColor,
		muted: theme.text.mutedColor,
		faint: theme.text.mutedColor,
		border: theme.block.borderColor,
		strongBorder: theme.block.borderColor,
		sunken: theme.surfaces.sunken,
		popover: theme.block.background,
		link: theme.accent.color,
		tableBackground: theme.table.background,
		tableBorder: theme.table.borderColor,
		tableBorderWidth: theme.table.borderWidth,
		tableHeaderBackground: theme.table.headerBackground,
		tableHeaderText: theme.table.headerText,
		tableDivider: theme.table.borderColor,
		series: theme.charts.series,
		barRadius: theme.charts.barRadius,
		bodyFont: theme.text.bodyFont,
		headingFont: theme.text.headingFont,
		fontStylesheets: theme.text.fontStylesheets,
		cssVariables,
	};
}

export function exportSeriesColor(palette: StoryExportPalette, index: number): string {
	return palette.series[index % palette.series.length];
}
