import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { StreamingResponse } from './StreamingResponse';

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  timestamp: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

describe('StreamingResponse', () => {
  it('shows the empty state with starter prompts before anything is asked', () => {
    render(<StreamingResponse messages={[]} isStreaming={false} />);
    expect(screen.getByText(/Welcome to GraphRAG Console/)).toBeInTheDocument();
    expect(screen.getByText(/Which suppliers are at risk/)).toBeInTheDocument();
  });

  it('renders a user message as plain text, not markdown', () => {
    // Asterisks a user typed are theirs, and must survive verbatim.
    render(
      <StreamingResponse
        messages={[message({ role: 'user', content: 'why **this**?' })]}
        isStreaming={false}
      />,
    );
    expect(screen.getByText('why **this**?')).toBeInTheDocument();
  });

  describe('assistant markdown', () => {
    // The regression this guards: answers arrive as markdown and were printed
    // raw, so readers saw literal asterisks and pipe-delimited tables.
    const markdown = [
      '# Findings',
      '',
      'Supplier **ITAMCO** is at risk.',
      '',
      '- delivery delays',
      '- quality issues',
      '',
      '| Supplier | Action |',
      '| --- | --- |',
      '| ITAMCO | Diversify |',
    ].join('\n');

    const renderAnswer = () =>
      render(
        <StreamingResponse
          messages={[message({ content: markdown, status: 'complete' })]}
          isStreaming={false}
        />,
      );

    it('renders headings as heading elements', () => {
      renderAnswer();
      expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    });

    it('renders emphasis as an element rather than asterisks', () => {
      renderAnswer();
      // Scoped by selector: ITAMCO also appears in the table below.
      expect(screen.getByText('ITAMCO', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('renders list items', () => {
      renderAnswer();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('renders GFM tables, which need the gfm plugin to work at all', () => {
      renderAnswer();
      const table = screen.getByRole('table');
      expect(within(table).getByRole('columnheader', { name: 'Supplier' })).toBeInTheDocument();
      expect(within(table).getByRole('cell', { name: 'Diversify' })).toBeInTheDocument();
    });

    it('wraps tables so a wide one scrolls instead of stretching the page', () => {
      renderAnswer();
      expect(screen.getByRole('table').closest('.markdown-table-wrap')).not.toBeNull();
    });
  });

  it('lists citations with their confidence', () => {
    render(
      <StreamingResponse
        messages={[
          message({
            content: 'Answer.',
            status: 'complete',
            citations: [
              { id: 'c1', source: 'Risk Assessment DB', text: 'Delay pattern', confidence: 0.92 },
            ],
          }),
        ]}
        isStreaming={false}
      />,
    );
    expect(screen.getByText('Sources (1)')).toBeInTheDocument();
    expect(screen.getByText('Risk Assessment DB')).toBeInTheDocument();
    expect(screen.getByText('92% confidence')).toBeInTheDocument();
  });

  it('shows an error with a retry action, and calls back when it is used', async () => {
    const onRetry = vi.fn();
    render(
      <StreamingResponse
        messages={[message({ status: 'error', error: 'The service returned 503.' })]}
        isStreaming={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('The service returned 503.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('marks a stopped answer, keeping whatever text arrived', () => {
    render(
      <StreamingResponse
        messages={[message({ content: 'Partial ans', status: 'stopped' })]}
        isStreaming={false}
      />,
    );
    expect(screen.getByText('Partial ans')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('shows the current retrieval stage while streaming', () => {
    render(
      <StreamingResponse
        messages={[message({ content: 'partial', status: 'streaming' })]}
        isStreaming
        currentStatus="Querying knowledge graph..."
      />,
    );
    expect(screen.getByText('Querying knowledge graph...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
