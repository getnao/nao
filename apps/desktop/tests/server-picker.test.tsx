import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commands = vi.hoisted(() => ({
	addServer: vi.fn(),
	removeServer: vi.fn(),
	selectServer: vi.fn(),
}));

vi.mock('@/lib/commands', () => commands);

import type { Server } from '@/lib/servers';
import { AddServer } from '@/screens/add-server';
import { ServerPicker } from '@/screens/server-picker';

const CLOUD: Server = {
	id: 'nao-cloud',
	name: 'nao Cloud',
	url: 'https://app.getnao.io',
	lastUsedAt: null,
	builtIn: true,
};
const ACME: Server = {
	id: 'acme',
	name: 'Acme',
	url: 'https://nao.acme.com',
	lastUsedAt: Date.now() - 60_000,
	builtIn: false,
};
const LOCAL: Server = {
	id: 'local',
	name: 'Local',
	url: 'http://localhost:5005',
	lastUsedAt: null,
	builtIn: false,
};

beforeEach(() => {
	vi.clearAllMocks();
	window.location.hash = '';
});

afterEach(() => {
	cleanup();
});

describe('ServerPicker', () => {
	function renderPicker(servers: Server[] | undefined = [LOCAL, ACME, CLOUD], loadError?: string) {
		const onServersChanged = vi.fn().mockResolvedValue(undefined);
		render(<ServerPicker servers={servers} loadError={loadError} onServersChanged={onServersChanged} />);
		return { onServersChanged };
	}

	function serverNames() {
		return within(screen.getByTestId('server-list'))
			.getAllByRole('button', { name: /Used|Never used/ })
			.map((button) => button.textContent ?? '');
	}

	it('lists nao Cloud first, then the most recently used servers', () => {
		renderPicker();

		const names = serverNames();
		expect(names[0]).toContain('nao Cloud');
		expect(names[1]).toContain('Acme');
		expect(names[2]).toContain('Local');
	});

	it('marks http servers as not secure', () => {
		renderPicker();

		expect(screen.getAllByText('Not secure')).toHaveLength(1);
		expect(serverNames()[2]).toContain('Not secure');
	});

	function serverButton(name: string) {
		return screen.getByRole('button', { name: new RegExp(`^${name}`) });
	}

	it('opens a server when it is clicked', async () => {
		commands.selectServer.mockResolvedValue(undefined);
		renderPicker();

		fireEvent.click(serverButton('Acme'));

		await waitFor(() => expect(commands.selectServer).toHaveBeenCalledWith('acme'));
	});

	it('never offers to remove nao Cloud', () => {
		renderPicker();

		expect(screen.queryByRole('button', { name: 'Remove nao Cloud' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Remove Acme' })).toBeTruthy();
	});

	it('asks for confirmation before removing a server, then refreshes the list', async () => {
		commands.removeServer.mockResolvedValue(undefined);
		const { onServersChanged } = renderPicker();

		fireEvent.click(screen.getByRole('button', { name: 'Remove Acme' }));
		expect(commands.removeServer).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(onServersChanged).toHaveBeenCalled());
		expect(commands.removeServer).toHaveBeenCalledWith('acme');
	});

	it('shows a readable error when opening a server fails', async () => {
		commands.selectServer.mockRejectedValue({ kind: 'unreachable' });
		renderPicker();

		fireEvent.click(serverButton('Acme'));

		expect(await screen.findByText(/couldn't reach this server/)).toBeTruthy();
	});

	it('shows the error when the server list cannot be loaded', () => {
		renderPicker(undefined, 'Could not read the server list.');

		expect(screen.getByText('Could not read the server list.')).toBeTruthy();
	});

	it('navigates to the add-server screen', () => {
		renderPicker();

		fireEvent.click(screen.getByRole('button', { name: /Add a server/ }));

		expect(window.location.hash).toBe('#/add-server');
	});
});

describe('AddServer', () => {
	function typeUrl(value: string) {
		fireEvent.change(screen.getByPlaceholderText('nao.your-company.com'), { target: { value } });
	}

	it('disables the submit button until a URL is entered', () => {
		render(<AddServer />);

		const submit = screen.getByRole('button', { name: 'Add server' }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		typeUrl('nao.acme.com');
		expect(submit.disabled).toBe(false);
	});

	it('warns about http:// servers', () => {
		render(<AddServer />);

		typeUrl('https://nao.acme.com');
		expect(screen.queryByText(/sent unencrypted/)).toBeNull();
		typeUrl('http://localhost:5005');
		expect(screen.getByText(/sent unencrypted/)).toBeTruthy();
	});

	it('adds the server and opens it', async () => {
		commands.addServer.mockResolvedValue(ACME);
		commands.selectServer.mockResolvedValue(undefined);
		render(<AddServer />);

		typeUrl('nao.acme.com');
		fireEvent.change(screen.getByPlaceholderText('Acme analytics'), { target: { value: 'Acme' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add server' }));

		await waitFor(() => expect(commands.selectServer).toHaveBeenCalledWith('acme'));
		expect(commands.addServer).toHaveBeenCalledWith('nao.acme.com', 'Acme');
	});

	it.each([
		[{ kind: 'not_nao' }, /doesn't look like a nao server/],
		[{ kind: 'too_old', version: null, minimum: '0.3.29' }, /needs nao 0.3.29 or later/],
		[{ kind: 'invalid_tls' }, /TLS certificate/],
		[{ kind: 'unreachable' }, /couldn't reach this server/],
	])('explains why a server was rejected (%o)', async (error, message) => {
		commands.addServer.mockRejectedValue(error);
		render(<AddServer />);

		typeUrl('nao.acme.com');
		fireEvent.click(screen.getByRole('button', { name: 'Add server' }));

		expect(await screen.findByText(message)).toBeTruthy();
		expect(commands.selectServer).not.toHaveBeenCalled();
	});
});
