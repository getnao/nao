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
