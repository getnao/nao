import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
	src: string;
	onClose: () => void;
}

export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		},
		[onClose],
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handleKeyDown]);

	return (
		<div
			className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in duration-150'
			onClick={onClose}
		>
			<button
				type='button'
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				className='absolute top-4 right-4 size-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer z-10'
			>
				<X className='size-5' />
			</button>
			<img
				src={src}
				alt=''
				className='max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl'
				onClick={(e) => e.stopPropagation()}
			/>
		</div>
	);
}
