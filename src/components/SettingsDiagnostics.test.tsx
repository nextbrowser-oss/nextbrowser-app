// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../shared/ui';
import { SettingsDiagnostics } from './SettingsDiagnostics';
import { invoke } from '../electronBridge';
vi.mock('../electronBridge', () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('copies through the main process and blocks duplicate clicks while collecting', async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockReturnValue(new Promise((resolve) => { finish = () => resolve({ cliStatus: 'available' }); }));
  render(<TooltipProvider><SettingsDiagnostics /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
  expect((screen.getByRole('button', { name: 'Collecting…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('support_diagnostics_copy');
  finish();
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Diagnostics copied.'));
});

it('explains partial diagnostics when an older CLI needs an update', async () => {
  vi.mocked(invoke).mockResolvedValue({ cliStatus: 'upgrade_required' });
  render(<TooltipProvider><SettingsDiagnostics /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Update nextctl for a complete report.'));
});

it('does not display raw exceptions that might contain credentials', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('password=private-value'));
  render(<TooltipProvider><SettingsDiagnostics /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
  await screen.findByRole('alert');
  expect(document.body.textContent).not.toContain('private-value');
});
