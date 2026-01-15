interface SlackEvent {
	type: string;
	user: string;
	ts: string;
	thread_ts?: string;
	text: string;
	channel: string;
	event_ts: string;
}

export interface SlackRequest {
	type?: string;
	challenge?: string;
	token?: string;
	event?: SlackEvent;
}
