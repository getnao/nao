import type { ImageBlock, MarkdownBlock } from '@slack/web-api';

export const addButtonStopBlock = () => {
	return {
		type: 'actions',
		elements: [
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: 'Stop Generation',
					emoji: true,
				},
				style: 'primary',
				action_id: 'stop_generation',
			},
		],
	};
};

export const createImageBlock = (imageUrl: string): ImageBlock => ({
	type: 'image',
	image_url: imageUrl,
	alt_text: 'chart',
});

export const createTextBlock = (text: string): MarkdownBlock => ({
	type: 'markdown',
	text: text,
});
