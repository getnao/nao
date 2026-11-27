import { invoke } from '@tauri-apps/api/core';

import type { Server } from '@/lib/servers';

export function listServers(): Promise<Server[]> {
	return invoke<Server[]>('list_servers');
}

export function addServer(url: string, name: string): Promise<Server> {
	return invoke<Server>('add_server', { url, name: name.trim() || null });
}

export function removeServer(id: string): Promise<void> {
	return invoke('remove_server', { id });
}

export function selectServer(id: string): Promise<void> {
	return invoke('select_server', { id });
}

export function startSignIn(serverId: string): Promise<void> {
	return invoke('start_sign_in', { serverId });
}

export function cancelSignIn(): Promise<void> {
	return invoke('cancel_sign_in');
}
