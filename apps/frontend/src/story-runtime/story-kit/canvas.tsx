import { joinClassNames } from '@nao/shared/class-names';
import { STORY_PRINT_CANVAS_ATTRIBUTE } from '@nao/shared/story-app';
import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { isPrintMode } from '../story-host';
import { useFrameRelativeStoryStyles } from './frame-styles';
import { fitScale, useStageSize } from './stage-fit';
import type { Size } from './stage-fit';
import type { CSSProperties, ReactNode } from 'react';

const DEFAULT_CANVAS_SIZE: Size = { width: 1440, height: 900 };

export interface CanvasProps {
	children: ReactNode;
	width?: number;
	height?: number;
	className?: string;
}

/**
 * A fixed-size story: laid out once at `width`×`height`, then scaled as a whole to fit the window, so its layout never
 * reflows.
 */
export function Canvas({ children, width, height, className }: CanvasProps) {
	useFrameRelativeStoryStyles();
	const canvas = canvasSize(width, height);
	if (isPrintMode()) {
		return (
			<PrintedCanvas canvas={canvas} className={className}>
				{children}
			</PrintedCanvas>
		);
	}
	return (
		<ScreenCanvas canvas={canvas} className={className}>
			{children}
		</ScreenCanvas>
	);
}

function ScreenCanvas({ canvas, className, children }: { canvas: Size; className?: string; children: ReactNode }) {
	const { stageRef, stage } = useStageSize<HTMLDivElement>();
	const scale = fitScale(stage, canvas);

	return (
		<div ref={stageRef} className='nao-canvas'>
			<div
				className='nao-canvas__viewport'
				style={
					{
						width: canvas.width * scale,
						height: canvas.height * scale,
						'--nao-canvas-scale': scale,
					} as CSSProperties
				}
			>
				<div className={joinClassNames('nao-canvas__surface', className)} style={canvas}>
					{children}
				</div>
			</div>
		</div>
	);
}

function PrintedCanvas({ canvas, className, children }: { canvas: Size; className?: string; children: ReactNode }) {
	useLayoutEffect(() => {
		document.documentElement.setAttribute(STORY_PRINT_CANVAS_ATTRIBUTE, `${canvas.width}x${canvas.height}`);
		return () => document.documentElement.removeAttribute(STORY_PRINT_CANVAS_ATTRIBUTE);
	}, [canvas.width, canvas.height]);

	return createPortal(
		<div className='nao-canvas nao-canvas--print'>
			<div className={joinClassNames('nao-canvas__surface', className)} style={canvas}>
				{children}
			</div>
		</div>,
		document.body,
	);
}

/** A size the agent wrote that cannot be laid out (zero, negative, not a number) falls back to the default. */
function canvasSize(width: number | undefined, height: number | undefined): Size {
	return {
		width: isLayoutLength(width) ? width : DEFAULT_CANVAS_SIZE.width,
		height: isLayoutLength(height) ? height : DEFAULT_CANVAS_SIZE.height,
	};
}

function isLayoutLength(length: number | undefined): length is number {
	return typeof length === 'number' && Number.isFinite(length) && length > 0;
}
