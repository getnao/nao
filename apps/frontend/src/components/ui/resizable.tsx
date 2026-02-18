import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
	return (
		<ResizablePrimitive.Group
			data-slot='resizable-panel-group'
			className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
			{...props}
		/>
	);
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
	return <ResizablePrimitive.Panel data-slot='resizable-panel' {...props} />;
}

function ResizableSeparator({
	withHandle,
	className,
	children,
	...props
}: ResizablePrimitive.SeparatorProps & {
	withHandle?: boolean;
}) {
	return (
		<ResizablePrimitive.Separator
			data-slot='resizable-handle'
			className={cn(
				'bg-border relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
				className,
			)}
			{...props}
		>
			{children}
			{withHandle && <ResizableHandle />}
		</ResizablePrimitive.Separator>
	);
}

function ResizableHandle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				'bg-background z-20 flex h-8 w-3 items-center justify-center rounded-full border hover:bg-accent transition-colors active:bg-accent',
				className,
			)}
			{...props}
		/>
	);
}

export { ResizableSeparator, ResizableHandle, ResizablePanel, ResizablePanelGroup };
