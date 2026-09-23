import { joinClassNames } from '@nao/shared/class-names';
import { PencilIcon } from 'lucide-react';
import { requestBlockEdit } from '../story-host';
import { useStoryEditing } from './hooks';
import type { StoryBlockEditRequest } from '@nao/shared/story-app';
import type { CSSProperties, ReactNode } from 'react';
import type { BlockData } from './use-block-data';

export interface BlockProps {
	title?: string;
	description?: string;
	className?: string;
	style?: CSSProperties;
}

interface BlockFrameProps extends BlockProps {
	kind: string;
	edit?: StoryBlockEditRequest;
	children: ReactNode;
}

export function Block({ kind, title, description, className, style, edit, children }: BlockFrameProps) {
	const editingEnabled = useStoryEditing();
	const canEdit = editingEnabled && edit !== undefined;
	return (
		<section className={joinClassNames('nao-block', `nao-${kind}`, className)} style={style}>
			{(title || description || canEdit) && (
				<header className='nao-block__header'>
					<div className='nao-block__heading'>
						{title && <h3 className='nao-block__title'>{title}</h3>}
						{description && <p className='nao-block__description'>{description}</p>}
					</div>
					{canEdit && (
						<button
							type='button'
							className='nao-block__edit'
							onClick={() => requestBlockEdit(edit)}
							title='Edit chart'
							aria-label='Edit chart'
						>
							<PencilIcon />
						</button>
					)}
				</header>
			)}
			<div className='nao-block__body'>{children}</div>
		</section>
	);
}

interface BlockStateProps {
	data: BlockData & { refetch: () => void };
	emptyMessage?: string;
	children: (rows: NonNullable<BlockData['rows']>, columns: string[]) => ReactNode;
}

export function BlockState({ data, emptyMessage = 'No rows.', children }: BlockStateProps) {
	if (data.status === 'loading') {
		return <div className='nao-skeleton' aria-busy='true' />;
	}
	if (data.status === 'error') {
		return (
			<div className='nao-block__state nao-block__state--error' role='alert'>
				{data.error}
				<button type='button' onClick={data.refetch}>
					Retry
				</button>
			</div>
		);
	}
	if (data.rows.length === 0) {
		return <div className='nao-block__state'>{emptyMessage}</div>;
	}
	return <>{children(data.rows, data.columns)}</>;
}
