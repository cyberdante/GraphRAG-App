import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import { acme, buildTheme } from '@/theme';
import { AttachmentPrompt } from './AttachmentPrompt';

const THEME = buildTheme(acme, false);

function renderPrompt(kind: 'url' | 'entity') {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ThemeProvider theme={THEME}>
      <AttachmentPrompt kind={kind} onCancel={onCancel} onConfirm={onConfirm} />
    </ThemeProvider>,
  );
  return { onConfirm, onCancel };
}

describe('AttachmentPrompt', () => {
  it('accepts a URL and hands it back trimmed', async () => {
    const { onConfirm } = renderPrompt('url');
    await userEvent.type(screen.getByLabelText('URL'), '  https://example.com/report  ');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(onConfirm).toHaveBeenCalledWith('https://example.com/report');
  });

  it('says why a value is wrong instead of just refusing it', async () => {
    // The thing a native prompt cannot do, and the reason this exists.
    const { onConfirm } = renderPrompt('url');
    await userEvent.type(screen.getByLabelText('URL'), 'example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(screen.getByText(/needs a scheme/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses a scheme the service will not fetch, before the round trip', async () => {
    const { onConfirm } = renderPrompt('url');
    await userEvent.type(screen.getByLabelText('URL'), 'file:///etc/passwd');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(screen.getByText(/Only http and https/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses credentials in the URL, matching the service', async () => {
    const { onConfirm } = renderPrompt('url');
    await userEvent.type(screen.getByLabelText('URL'), 'http://admin:pw@example.com/');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(screen.getByText(/credentials/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses an empty value', async () => {
    const { onConfirm } = renderPrompt('entity');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not apply URL rules to an entity id', async () => {
    const { onConfirm } = renderPrompt('entity');
    await userEvent.type(screen.getByLabelText('Entity ID'), 'sup_88');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(onConfirm).toHaveBeenCalledWith('sup_88');
  });

  it('submits on Enter', async () => {
    const { onConfirm } = renderPrompt('entity');
    await userEvent.type(screen.getByLabelText('Entity ID'), 'risk_12{Enter}');

    expect(onConfirm).toHaveBeenCalledWith('risk_12');
  });

  it('explains what attaching a page will do', async () => {
    renderPrompt('url');

    expect(screen.getByText(/cited alongside the graph/)).toBeInTheDocument();
    expect(screen.getByText(/loopback and link-local addresses are refused/)).toBeInTheDocument();
  });

  it('clears the error as soon as the value changes', async () => {
    const { onConfirm } = renderPrompt('url');
    const field = screen.getByLabelText('URL');
    await userEvent.type(field, 'nonsense');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(screen.getByText(/needs a scheme/)).toBeInTheDocument();

    await userEvent.clear(field);
    await userEvent.type(field, 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(onConfirm).toHaveBeenCalledWith('https://example.com');
  });
});
