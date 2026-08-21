import { useEffect, useRef, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import maplibregl from 'maplibre-gl';

import type { CustomBoundarySet } from '@nao/shared';
import type { FeatureCollection } from 'geojson';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from '@/hooks/use-map-style';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

import 'maplibre-gl/dist/maplibre-gl.css';

interface SettingsDisplayMapProps {
	isAdmin: boolean;
}

export function SettingsDisplayMap({ isAdmin }: SettingsDisplayMapProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.project.getAgentSettings.queryOptions().queryKey });
			},
		}),
	);

	const displayMapEnabled = agentSettings.data?.mapEnabled ?? true;

	const handleDisplayMapChange = (enabled: boolean) => {
		updateAgentSettings.mutate({ mapEnabled: enabled });
	};

	return (
		<SettingsCard
			title='Maps'
			description='Allow the agent to render query results on an interactive map (web chat only).'
		>
			<SettingsControlRow
				id='display-map'
				label='Enable maps'
				description='Enables "points", "scatter_bubble" and "choropleth" map types for the agent.'
				control={
					<Switch
						id='display-map'
						checked={displayMapEnabled}
						onCheckedChange={handleDisplayMapChange}
						disabled={!isAdmin || updateAgentSettings.isPending}
					/>
				}
			/>
			<MapBoundariesLibrary isAdmin={isAdmin} />
		</SettingsCard>
	);
}

function MapBoundariesLibrary({ isAdmin }: { isAdmin: boolean }) {
	const [expandedKey, setExpandedKey] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<CustomBoundarySet | null>(null);

	const { data: boundaries = [], isLoading } = useQuery(trpc.project.getMapBoundaries.queryOptions());

	const deleteMutation = useMutation(
		trpc.project.deleteMapBoundary.mutationOptions({
			onSuccess: (next, _, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getMapBoundaries.queryKey(), next);
			},
		}),
	);

	const toggleExpanded = (key: string) => setExpandedKey((prev) => (prev === key ? null : key));

	const confirmDelete = () => {
		if (deleteTarget) {
			deleteMutation.mutate({ key: deleteTarget.key });
			setDeleteTarget(null);
		}
	};

	return (
		<div className='flex flex-col gap-3'>
			<SettingsControlRow
				label='GeoJSON Boundary Library'
				description='Custom boundary sets the agent can use for choropleth maps.'
				control={
					isAdmin ? (
						<Button variant='secondary' size='sm' onClick={() => toggleExpanded('__new__')}>
							<Plus className='size-4' />
							Add
						</Button>
					) : null
				}
			/>

			{isLoading ? (
				<div className='text-sm text-muted-foreground py-1'>Loading…</div>
			) : (
				<div className='flex flex-col gap-1'>
					{boundaries.length === 0 && expandedKey !== '__new__' && (
						<Empty>No custom boundary sets yet.</Empty>
					)}
					{boundaries.map((set) => (
						<BoundarySetItem
							key={set.key}
							set={set}
							isAdmin={isAdmin}
							isExpanded={expandedKey === set.key}
							onToggle={() => toggleExpanded(set.key)}
							onDelete={() => setDeleteTarget(set)}
							onSaved={() => setExpandedKey(null)}
						/>
					))}
					{expandedKey === '__new__' && (
						<BoundaryEditPanel
							editTarget={null}
							onClose={() => setExpandedKey(null)}
							onSaved={() => setExpandedKey(null)}
						/>
					)}
				</div>
			)}

			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete boundary set</AlertDialogTitle>
						<AlertDialogDescription>
							Remove <strong>{deleteTarget?.label}</strong> ({deleteTarget?.key}) from the library? Maps
							using this set will no longer display regions.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
							onClick={confirmDelete}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function BoundarySetItem({
	set,
	isAdmin,
	isExpanded,
	onToggle,
	onDelete,
	onSaved,
}: {
	set: CustomBoundarySet;
	isAdmin: boolean;
	isExpanded: boolean;
	onToggle: () => void;
	onDelete: () => void;
	onSaved: () => void;
}) {
	if (!isAdmin) {
		return (
			<div className='flex items-center gap-3 min-w-0 px-1 py-1.5'>
				<span className='min-w-0'>
					<span className='block text-sm font-medium truncate'>{set.label}</span>
					{set.featureCount != null && (
						<span className='block text-xs text-muted-foreground'>{set.featureCount} features</span>
					)}
				</span>
			</div>
		);
	}

	return (
		<div className='rounded-md'>
			<div className='flex items-center justify-between gap-2 pr-1'>
				<button
					type='button'
					onClick={onToggle}
					className='flex flex-1 items-center gap-3 min-w-0 rounded-md px-1 py-1.5 text-left cursor-pointer'
				>
					<span className='flex size-7 items-center justify-center shrink-0 text-muted-foreground'>
						{isExpanded ? <ChevronUp className='size-3.5' /> : <ChevronDown className='size-3.5' />}
					</span>
					<span className='min-w-0'>
						<span className='block text-sm font-medium truncate'>{set.label}</span>
						{set.featureCount != null && (
							<span className='block text-xs text-muted-foreground'>{set.featureCount} features</span>
						)}
					</span>
				</button>
				<Button
					variant='ghost'
					size='icon'
					className='size-7 shrink-0 text-destructive hover:text-destructive'
					onClick={onDelete}
				>
					<Trash2 className='size-3.5' />
				</Button>
			</div>
			{isExpanded && <BoundaryEditPanel editTarget={set} onClose={onToggle} onSaved={onSaved} />}
		</div>
	);
}

function BoundaryEditPanel({
	editTarget,
	onClose,
	onSaved,
}: {
	editTarget: CustomBoundarySet | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const isEdit = editTarget !== null;

	const [url, setUrl] = useState('');
	const [label, setLabel] = useState('');
	const [key, setKey] = useState('');
	const [joinProperty, setJoinProperty] = useState('');
	const [regionKeyHint, setRegionKeyHint] = useState('');
	const [propertyKeys, setPropertyKeys] = useState<string[]>([]);
	const [previewGeojson, setPreviewGeojson] = useState<FeatureCollection | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [featureCount, setFeatureCount] = useState<number | undefined>(undefined);

	const validateMutation = useMutation(trpc.project.validateMapBoundaryUrl.mutationOptions());
	const addMutation = useMutation(
		trpc.project.addMapBoundary.mutationOptions({
			onSuccess: (next, _, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getMapBoundaries.queryKey(), next);
			},
		}),
	);
	const updateMutation = useMutation(
		trpc.project.updateMapBoundary.mutationOptions({
			onSuccess: (next, _, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getMapBoundaries.queryKey(), next);
			},
		}),
	);

	const loadPreview = async (targetUrl: string) => {
		if (!targetUrl.trim()) {
			return;
		}
		setLoadError(null);
		setPreviewGeojson(null);
		try {
			const result = await validateMutation.mutateAsync({ url: targetUrl });
			setPropertyKeys(result.propertyKeys);
			setPreviewGeojson(result.geojson as FeatureCollection);
			setFeatureCount(result.featureCount);
			setJoinProperty((prev) => prev || (result.propertyKeys.length === 1 ? result.propertyKeys[0] : ''));
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : 'Failed to load GeoJSON.');
		}
	};

	useEffect(() => {
		if (editTarget) {
			setUrl(editTarget.url);
			setLabel(editTarget.label);
			setKey(editTarget.key);
			setJoinProperty(editTarget.joinProperty);
			setRegionKeyHint(editTarget.regionKeyHint);
			setFeatureCount(editTarget.featureCount);
			setPropertyKeys([]);
			loadPreview(editTarget.url);
		} else {
			setUrl('');
			setLabel('');
			setKey('');
			setJoinProperty('');
			setRegionKeyHint('');
			setFeatureCount(undefined);
			setPropertyKeys([]);
			setPreviewGeojson(null);
			setLoadError(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editTarget]);

	const canSave =
		url.trim() !== '' &&
		label.trim() !== '' &&
		key.trim() !== '' &&
		joinProperty !== '' &&
		regionKeyHint.trim() !== '' &&
		(isEdit || previewGeojson !== null);

	const handleSave = async () => {
		if (!canSave) {
			return;
		}
		if (isEdit) {
			const newKey = key !== editTarget.key ? key : undefined;
			await updateMutation.mutateAsync({
				key: editTarget.key,
				newKey,
				label,
				url,
				joinProperty,
				regionKeyHint,
				featureCount,
			});
		} else {
			await addMutation.mutateAsync({ key, label, url, joinProperty, regionKeyHint, featureCount });
		}
		onSaved();
	};

	const isSaving = addMutation.isPending || updateMutation.isPending;

	return (
		<div
			className={cn(
				'px-4 pb-4 pt-2 flex flex-col gap-4 border rounded-md',
				editTarget ? 'bg-muted/30' : 'border-dashed',
			)}
		>
			<Field label='GeoJSON URL'>
				<Input
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					onBlur={() => loadPreview(url)}
					placeholder='https://example.com/regions.geojson'
					disabled={validateMutation.isPending}
				/>
				{loadError && <p className='text-xs text-destructive'>{loadError}</p>}
				{validateMutation.isPending && <p className='text-xs text-muted-foreground'>Loading…</p>}
				{featureCount != null && propertyKeys.length > 1 && (
					<p className='text-xs text-muted-foreground'>
						{featureCount} features · {propertyKeys.length} properties
					</p>
				)}
			</Field>

			{previewGeojson && (
				<Field label='Preview'>
					<BoundaryPreviewMap geojson={previewGeojson} />
				</Field>
			)}

			<Field label='Label'>
				<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='French postal codes' />
			</Field>

			<Field
				label='Key'
				hint={
					<>
						Lowercase letters, digits and underscores only. This is the value the agent passes in{' '}
						<code className='font-mono'>region_boundaries</code>.
					</>
				}
			>
				<Input
					value={key}
					onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
					placeholder='french_postal_codes'
					className='font-mono'
				/>
			</Field>

			<Field
				label='Join property'
				hint={
					<>
						The GeoJSON feature property whose value must match the SQL{' '}
						<code className='font-mono'>region_key</code> column.
					</>
				}
			>
				<Select value={joinProperty} onValueChange={setJoinProperty} disabled={propertyKeys.length === 0}>
					<SelectTrigger>
						<SelectValue placeholder='Load a URL to see available properties…' />
					</SelectTrigger>
					<SelectContent>
						{propertyKeys.map((prop) => (
							<SelectItem key={prop} value={prop}>
								{prop}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>

			<Field
				label='Region key hint'
				hint={
					<>
						Explains to the agent what values to produce in the{' '}
						<code className='font-mono'>region_key</code> column, so it writes the right SQL.
					</>
				}
			>
				<Textarea
					value={regionKeyHint}
					onChange={(e) => setRegionKeyHint(e.target.value)}
					placeholder='5-digit French postal code (e.g. 75001 for Paris 1st)'
					rows={2}
				/>
			</Field>

			<div className='flex justify-end gap-2'>
				<Button variant='ghost' size='sm' onClick={onClose} disabled={isSaving}>
					Cancel
				</Button>
				<Button size='sm' onClick={handleSave} disabled={!canSave || isSaving}>
					{isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to library'}
				</Button>
			</div>
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className='flex flex-col gap-1.5'>
			<p className='text-sm font-medium'>{label}</p>
			{children}
			{hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
		</div>
	);
}

function BoundaryPreviewMap({ geojson }: { geojson: FeatureCollection }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);

	const isDark = document.documentElement.classList.contains('dark');
	const styleUrl = isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const map = new maplibregl.Map({
			container,
			style: styleUrl,
			attributionControl: false,
		});
		mapRef.current = map;

		map.on('load', () => {
			map.addSource('preview', { type: 'geojson', data: geojson });
			map.addLayer({
				id: 'preview-fill',
				type: 'fill',
				source: 'preview',
				paint: { 'fill-color': '#522bff', 'fill-opacity': 0.25 },
			});
			map.addLayer({
				id: 'preview-line',
				type: 'line',
				source: 'preview',
				paint: { 'line-color': '#522bff', 'line-width': 1, 'line-opacity': 0.7 },
			});

			const bounds = new maplibregl.LngLatBounds();
			let hasCoords = false;
			const extendBounds = (coords: unknown) => {
				if (!Array.isArray(coords)) {
					return;
				}
				if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
					bounds.extend([coords[0] as number, coords[1] as number]);
					hasCoords = true;
					return;
				}
				coords.forEach((c) => extendBounds(c));
			};
			for (const feature of geojson.features) {
				if (feature.geometry) {
					extendBounds((feature.geometry as { coordinates?: unknown }).coordinates);
				}
			}
			if (hasCoords && !bounds.isEmpty()) {
				map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
			}
		});

		return () => {
			map.remove();
			mapRef.current = null;
		};
	}, [geojson, styleUrl]);

	return <div ref={containerRef} className='h-48 w-full rounded-md border overflow-hidden' />;
}
