import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import { acme, buildTheme } from '@/theme';
import { QueryInput } from './QueryInput';

const THEME = buildTheme(acme, false);

function renderInput() {
  const onSubmit = vi.fn();
  render(
    <ThemeProvider theme={THEME}>
      <QueryInput placeholder="Ask a question" onSubmit={onSubmit} />
    </ThemeProvider>,
  );
  return { onSubmit, field: screen.getByPlaceholderText('Ask a question') };
}

/**
 * The notice warns and does not redact. Both halves matter: a question that
 * silently loses an email gets a worse answer and the asker never learns why.
 */
describe('personal data in a question', () => {
  it('says nothing about an ordinary question', async () => {
    const { field } = renderInput();
    await userEvent.type(field, 'Which suppliers are at risk?');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names what it spotted, as it is typed', async () => {
    const { field } = renderInput();
    await userEvent.type(field, 'what did dana@example.com order?');

    expect(screen.getByRole('status')).toHaveTextContent('an email address');
  });

  it('sends the question exactly as typed, warning and all', async () => {
    // The negative control for redaction: had the notice altered the text, this
    // is where it would show, and the asker would never know.
    const { onSubmit, field } = renderInput();
    await userEvent.type(field, 'what did dana@example.com order?');
    await userEvent.click(screen.getByRole('button', { name: 'Send query' }));

    expect(onSubmit).toHaveBeenCalledWith('what did dana@example.com order?', [], [], []);
  });

  it('does not block sending', async () => {
    const { field } = renderInput();
    await userEvent.type(field, 'call +44 20 7946 0958');

    expect(screen.getByRole('button', { name: 'Send query' })).toBeEnabled();
  });

  it('clears with the question it was about', async () => {
    const { field } = renderInput();
    await userEvent.type(field, 'dana@example.com');
    expect(screen.getByRole('status')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send query' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
