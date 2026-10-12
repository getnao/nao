import { joinClassNames } from '@nao/shared/class-names';
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
	const { stageRef, stage } = useStageSize<HTMLDivElement>();
	const print = isPrintMode();
	const canvas = canvasSize(width, height);
	const scale = print ? fitToWidth(stage, canvas) : fitScale(stage, canvas);

	return (
		<div ref={stageRef} className={joinClassNames('nao-canvas', print && 'nao-canvas--print')}>
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

/** A printed page has no fixed height: the canvas only shrinks to the page width. */
function fitToWidth(stage: Size, canvas: Size): number {
	return stage.width > 0 ? Math.min(stage.width / canvas.width, 1) : 1;
}
