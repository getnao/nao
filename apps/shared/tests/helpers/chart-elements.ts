import React, { type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

export interface ChartElementProps {
	[key: string]: unknown;
	background?: unknown;
	barSize?: number;
	children?: unknown;
	domain?: unknown;
	fill?: string;
	hide?: boolean;
	id?: string;
	label?: { value?: string };
	maxBarSize?: number;
	radius?: number[];
	shape?: (props: unknown) => ReactElement<{ radius?: number[]; stroke?: string; strokeWidth?: number }>;
	stackId?: string;
	tickFormatter?: (value: string | number) => string;
	width?: number;
	yAxisId?: string;
}

export type ChartElement = ReactElement<ChartElementProps>;

export function findChartElement(parent: ReactElement, displayName: string): ChartElement | undefined {
	return findChartElements(parent, displayName)[0];
}

export function findChartElements(parent: ReactElement, displayName: string): ChartElement[] {
	const children = (parent.props as { children?: unknown }).children;
	return flattenChildren(children).filter((child) => getDisplayName(child) === displayName);
}

export function flattenChildren(children: unknown): ChartElement[] {
	if (Array.isArray(children)) {
		return children.flatMap(flattenChildren);
	}
	if (isReactElement(children)) {
		return [children];
	}
	return [];
}

export function renderChart(chart: ReactElement, width = 600, height = 400): string {
	return renderToString(
		React.cloneElement(chart as ReactElement<{ width?: number; height?: number }>, { width, height }),
	);
}

function isReactElement(value: unknown): value is ChartElement {
	return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}

function getDisplayName(element: ReactElement): string | undefined {
	return typeof element.type === 'string' ? element.type : (element.type as { displayName?: string }).displayName;
}
