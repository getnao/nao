import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { ColumnValueKind } from '@/lib/chart-selection-summary';

const COLUMN_DATA_TYPE = 'application/x-nao-column';
/** The payload is unreadable until drop, so the kind travels in the type list to let targets accept or refuse. */
const KIND_DATA_TYPE_PREFIX = 'application/x-nao-column-kind-';

type AcceptsKind = (kind: ColumnValueKind) => boolean;

interface ColumnDropTargetOptions {
	onDrop: (column: string) => void;
	acceptsKind?: AcceptsKind;
}

export function startColumnDrag(event: DragEvent, column: string, kind: ColumnValueKind) {
	event.dataTransfer.setData(COLUMN_DATA_TYPE, column);
	event.dataTransfer.setData(`${KIND_DATA_TYPE_PREFIX}${kind}`, kind);
	event.dataTransfer.setData('text/plain', column);
	event.dataTransfer.effectAllowed = 'copy';
}

/** The kind of the column being dragged anywhere in the document, or null when no column drag is in progress. */
export function useDraggedColumnKind(): ColumnValueKind | null {
	const [kind, setKind] = useState<ColumnValueKind | null>(null);

	useEffect(() => {
		const handleDragStart = (event: globalThis.DragEvent) => {
			const draggedKind = readDraggedKind(event.dataTransfer?.types);
			requestAnimationFrame(() => setKind(draggedKind));
		};
		const handleDragEnd = () => setKind(null);
		document.addEventListener('dragstart', handleDragStart);
		document.addEventListener('dragend', handleDragEnd);
		document.addEventListener('drop', handleDragEnd);
		return () => {
			document.removeEventListener('dragstart', handleDragStart);
			document.removeEventListener('dragend', handleDragEnd);
			document.removeEventListener('drop', handleDragEnd);
		};
	}, []);

	return kind;
}

export function useColumnDropTarget({ onDrop, acceptsKind = acceptAnyKind }: ColumnDropTargetOptions) {
	const [isOver, setIsOver] = useState(false);

	function canAccept(event: DragEvent) {
		const kind = readDraggedKind(event.dataTransfer.types);
		return kind !== null && acceptsKind(kind);
	}

	const dropTargetProps = {
		onDragOver: (event: DragEvent) => {
			if (!canAccept(event)) {
				return;
			}
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			setIsOver(true);
		},
		onDragLeave: (event: DragEvent) => {
			if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
				return;
			}
			setIsOver(false);
		},
		onDrop: (event: DragEvent) => {
			setIsOver(false);
			const column = event.dataTransfer.getData(COLUMN_DATA_TYPE);
			if (!column || !canAccept(event)) {
				return;
			}
			event.preventDefault();
			onDrop(column);
		},
	};

	return { isOver, dropTargetProps };
}

export function acceptNumericKind(kind: ColumnValueKind): boolean {
	return kind === 'number' || kind === 'empty';
}

function acceptAnyKind(): boolean {
	return true;
}

function readDraggedKind(types: readonly string[] | undefined): ColumnValueKind | null {
	if (!types?.includes(COLUMN_DATA_TYPE)) {
		return null;
	}
	const kindType = types.find((type) => type.startsWith(KIND_DATA_TYPE_PREFIX));
	return kindType ? (kindType.slice(KIND_DATA_TYPE_PREFIX.length) as ColumnValueKind) : 'mixed';
}
