import { AlertTriangle } from 'lucide-react';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
	toolName: string;
	/** Changing this retries a render that threw, so a new call never inherits the old failure. */
	resetKey: string;
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

/**
 * Contains a crash inside one tool renderer so an unvalidated input shape cannot unmount the
 * conversation around it.
 */
export class ToolCallErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidUpdate(previousProps: Props) {
		if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
			this.setState({ hasError: false });
		}
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error(`Tool call "${this.props.toolName}" failed to render:`, error, info.componentStack);
	}

	render() {
		if (this.state.hasError) {
			return <ToolCallRenderError toolName={this.props.toolName} />;
		}
		return this.props.children;
	}
}

const ToolCallRenderError = ({ toolName }: { toolName: string }) => (
	<div className='flex items-start gap-2 rounded-xl border border-border bg-muted/30 -mx-3 px-4 py-3'>
		<AlertTriangle size={16} className='mt-0.5 shrink-0 text-muted-foreground' />
		<div className='flex flex-col gap-0.5'>
			<span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Display error</span>
			<p className='text-sm text-foreground/70'>
				This <span className='font-medium'>{toolName}</span> step could not be displayed. The rest of the
				conversation is unaffected.
			</p>
		</div>
	</div>
);
