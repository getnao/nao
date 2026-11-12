import { pluralize } from '@nao/shared';
import { ListFilter, Tag, User } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { TestDefinition } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FilterChip } from '@/components/ui/filter-chip';
import { useResizeObserver } from '@/hooks/use-resize-observer';
import { cn } from '@/lib/utils';

/** A test is shown when it has one of the picked tags, if any, and one of the picked owners, if any. */
export interface TestFilters {
	tags: string[];
	owners: string[];
}

export const NO_TEST_FILTERS: TestFilters = { tags: [], owners: [] };

interface TestFiltersProps {
	filters: TestFilters;
	onChange: (filters: TestFilters) => void;
}

/** Which groups show as a count instead of one chip per pick. */
interface ChipLayout {
	collapseTags: boolean;
	collapseOwners: boolean;
}

export function TestSuiteFilterMenu({ tests, filters, onChange }: TestFiltersProps & { tests: TestDefinition[] }) {
	const tags = listTags(tests);
	const owners = listOwners(tests);
	if (tags.length === 0 && owners.length === 0) {
		return null;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='icon-xs'
					aria-label='Filter the tests'
					className={cn(
						'shrink-0 text-muted-foreground hover:text-foreground',
						hasTestFilters(filters) && 'bg-accent text-foreground',
					)}
				>
					<ListFilter />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='max-h-80 w-56 overflow-y-auto'>
				<FilterGroup
					label='Tags'
					values={tags}
					picked={filters.tags}
					onChange={(picked) => onChange({ ...filters, tags: picked })}
				/>
				{tags.length > 0 && owners.length > 0 && <DropdownMenuSeparator />}
				<FilterGroup
					label='Owners'
					values={owners}
					picked={filters.owners}
					onChange={(picked) => onChange({ ...filters, owners: picked })}
				/>
				{hasTestFilters(filters) && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => onChange(NO_TEST_FILTERS)}>Clear filters</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ActiveTestFilters(props: TestFiltersProps) {
	return hasTestFilters(props.filters) ? <ActiveTestFilterChips {...props} /> : null;
}

export function matchesTestFilters(test: TestDefinition, filters: TestFilters): boolean {
	return hasAnyPicked(test.tags, filters.tags) && hasAnyPicked(test.owner ? [test.owner] : [], filters.owners);
}

export function hasTestFilters(filters: TestFilters): boolean {
	return filters.tags.length > 0 || filters.owners.length > 0;
}

/**
 * One chip per picked tag and owner while they all fit on the header line, else the groups collapse into counts,
 * the one with the most picks first, so the header never grows.
 */
function ActiveTestFilterChips({ filters, onChange }: TestFiltersProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const layouts = listChipLayouts(filters);
	const [layoutIndex, setLayoutIndex] = useState(0);
	const [containerWidth, setContainerWidth] = useState(0);
	const [laidOutFor, setLaidOutFor] = useState({ filters, containerWidth });

	if (laidOutFor.filters !== filters || laidOutFor.containerWidth !== containerWidth) {
		setLaidOutFor({ filters, containerWidth });
		setLayoutIndex(0);
	}

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (container && isOverflowing(container) && layoutIndex < layouts.length - 1) {
			setLayoutIndex(layoutIndex + 1);
		}
	}, [laidOutFor, layoutIndex, layouts.length]);

	useResizeObserver(containerRef, (container) => setContainerWidth(container.clientWidth));

	const layout = layouts[layoutIndex];
	return (
		<div
			ref={containerRef}
			className='flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden'
			aria-label='Active filters'
		>
			<GroupChips
				noun='tag'
				icon={<Tag />}
				values={filters.tags}
				isCollapsed={layout.collapseTags}
				onChange={(tags) => onChange({ ...filters, tags })}
			/>
			<GroupChips
				noun='owner'
				icon={<User />}
				values={filters.owners}
				isCollapsed={layout.collapseOwners}
				onChange={(owners) => onChange({ ...filters, owners })}
			/>
		</div>
	);
}

function FilterGroup({
	label,
	values,
	picked,
	onChange,
}: {
	label: string;
	values: string[];
	picked: string[];
	onChange: (picked: string[]) => void;
}) {
	if (values.length === 0) {
		return null;
	}
	return (
		<>
			<DropdownMenuLabel className='text-xs'>{label}</DropdownMenuLabel>
			{values.map((value) => (
				<DropdownMenuCheckboxItem
					key={value}
					checked={picked.includes(value)}
					onCheckedChange={() => onChange(toggle(picked, value))}
					onSelect={(event) => event.preventDefault()}
				>
					<span className='truncate' title={value}>
						{value}
					</span>
				</DropdownMenuCheckboxItem>
			))}
		</>
	);
}

function GroupChips({
	noun,
	icon,
	values,
	isCollapsed,
	onChange,
}: {
	noun: string;
	icon: ReactNode;
	values: string[];
	isCollapsed: boolean;
	onChange: (values: string[]) => void;
}) {
	if (isCollapsed && values.length > 0) {
		return (
			<FilterChip
				icon={icon}
				label={`${values.length} ${pluralize(noun, values.length)}`}
				title={values.join(', ')}
				onRemove={() => onChange([])}
			/>
		);
	}
	return values.map((value) => (
		<FilterChip key={value} icon={icon} label={value} onRemove={() => onChange(without(values, value))} />
	));
}

/** From the most detailed to the most compact. */
function listChipLayouts(filters: TestFilters): ChipLayout[] {
	const collapseTagsFirst = filters.tags.length >= filters.owners.length;
	return [
		{ collapseTags: false, collapseOwners: false },
		{ collapseTags: collapseTagsFirst, collapseOwners: !collapseTagsFirst },
		{ collapseTags: true, collapseOwners: true },
	];
}

function isOverflowing(element: HTMLElement): boolean {
	return element.scrollWidth > element.clientWidth;
}

function listTags(tests: TestDefinition[]): string[] {
	return [...new Set(tests.flatMap((test) => test.tags))].sort();
}

function listOwners(tests: TestDefinition[]): string[] {
	return [...new Set(tests.flatMap((test) => (test.owner ? [test.owner] : [])))].sort();
}

function hasAnyPicked(values: string[], picked: string[]): boolean {
	return picked.length === 0 || values.some((value) => picked.includes(value));
}

function toggle(values: string[], value: string): string[] {
	return values.includes(value) ? without(values, value) : [...values, value];
}

function without(values: string[], value: string): string[] {
	return values.filter((other) => other !== value);
}
