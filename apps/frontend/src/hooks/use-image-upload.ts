import { useState, useCallback, useRef } from 'react';

import { ALLOWED_IMAGE_MEDIA_TYPES } from '@nao/shared/types';
import type { ImageMediaType, ImageUploadData } from '@nao/shared/types';

export interface UploadedImage {
	id: string;
	file: File;
	dataUrl: string;
	mediaType: ImageMediaType;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES: ReadonlySet<string> = new Set(ALLOWED_IMAGE_MEDIA_TYPES);

function isAcceptedImageType(type: string): type is ImageMediaType {
	return ACCEPTED_TYPES.has(type);
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

function extractBase64(dataUrl: string): string {
	const idx = dataUrl.indexOf(',');
	return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

export function useImageUpload() {
	const [images, setImages] = useState<UploadedImage[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const addFiles = useCallback(
		async (files: FileList | File[]) => {
			const fileArray = Array.from(files).filter((f) => isAcceptedImageType(f.type) && f.size <= MAX_IMAGE_SIZE);

			if (fileArray.length === 0) {
				return;
			}

			const slotsAvailable = MAX_IMAGES - images.length;
			const filesToProcess = fileArray.slice(0, Math.max(0, slotsAvailable));

			const newImages: UploadedImage[] = [];
			for (const file of filesToProcess) {
				const dataUrl = await readFileAsDataUrl(file);
				newImages.push({
					id: crypto.randomUUID(),
					file,
					dataUrl,
					mediaType: file.type as ImageMediaType,
				});
			}

			if (newImages.length > 0) {
				setImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
			}
		},
		[images.length],
	);

	const removeImage = useCallback((id: string) => {
		setImages((prev) => prev.filter((img) => img.id !== id));
	}, []);

	const clearImages = useCallback(() => {
		setImages([]);
	}, []);

	const openFilePicker = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (e.target.files) {
				addFiles(e.target.files);
			}
			e.target.value = '';
		},
		[addFiles],
	);

	const handlePaste = useCallback(
		(e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) {
				return;
			}

			const imageFiles: File[] = [];
			for (const item of items) {
				if (item.kind === 'file' && isAcceptedImageType(item.type)) {
					const file = item.getAsFile();
					if (file) {
						imageFiles.push(file);
					}
				}
			}

			if (imageFiles.length > 0) {
				e.preventDefault();
				addFiles(imageFiles);
			}
		},
		[addFiles],
	);

	const getImagesForUpload = useCallback((): ImageUploadData[] => {
		return images.map((img) => ({
			mediaType: img.mediaType,
			data: extractBase64(img.dataUrl),
		}));
	}, [images]);

	return {
		images,
		fileInputRef,
		addFiles,
		removeImage,
		clearImages,
		openFilePicker,
		handleFileInputChange,
		handlePaste,
		getImagesForUpload,
		hasImages: images.length > 0,
		canAddMore: images.length < MAX_IMAGES,
	};
}
