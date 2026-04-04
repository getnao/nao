import { X } from 'lucide-react';
import type { UploadedImage } from '@/hooks/use-image-upload';

interface ChatInputImagePreviewProps {
	images: UploadedImage[];
	onRemove: (id: string) => void;
}

export function ChatInputImagePreview({ images, onRemove }: ChatInputImagePreviewProps) {
	const hasImages = images.length > 0;

	return (
		<div
			className='grid w-full transition-[grid-template-rows] duration-200 ease-out'
			style={{ gridTemplateRows: hasImages ? '1fr' : '0fr' }}
		>
			<div className='overflow-hidden'>
				<div className='flex gap-2 px-3 pt-3 pb-1 flex-wrap justify-start'>
					{images.map((image) => (
						<div
							key={image.id}
							className='relative group/preview animate-in fade-in zoom-in-75 duration-200'
						>
							<img
								src={image.dataUrl}
								alt=''
								className='size-16 rounded-lg object-cover border border-border'
							/>
							<button
								type='button'
								onClick={() => onRemove(image.id)}
								className='absolute -top-1.5 -right-1.5 size-5 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity cursor-pointer'
							>
								<X className='size-3' />
							</button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
