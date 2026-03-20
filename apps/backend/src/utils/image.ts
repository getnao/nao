export const buildImageUrl = (imageId: string): string => `/i/${imageId}`;

export const buildImageDataUrl = (mediaType: string, base64Data: string): string =>
	`data:${mediaType};base64,${base64Data}`;
