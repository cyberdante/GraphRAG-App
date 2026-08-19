import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';
import type { DomainInfo, Tenant } from '@ragstone/shared';
import { acme, buildTheme } from '@/theme';
import { ThemeEditor } from './ThemeEditor';

const THEME = buildTheme(acme, false);

const DOMAINS: DomainInfo[] = [
  { id: 'supply-chain', label: 'Supply chain', version: '1.0.0', classes: ['Supplier'], starters: [], presets: [], ontology: '/ontology/supply-chain.ttl', default: true },
  { id: 'clinical-trials', label: 'Clinical trials', version: '1.0.0', classes: ['Trial'], starters: [], presets: [], ontology: '/ontology/clinical-trials.ttl', default: false },
];

function renderEditor(tenant: Tenant = acme, darkMode = false) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <ThemeProvider theme={THEME}>
      <ThemeEditor
        open
        onClose={vi.fn()}
        tenant={tenant}
        onChange={onChange}
        onReset={onReset}
        domains={DOMAINS}
        darkMode={darkMode}
      />
    </ThemeProvider>,
  );
  return { onChange, onReset };
}

describe('ThemeEditor', () => {
  it('edits the live tenant rather than a copy to be applied later', async () => {
    // The whole point: every change is visible in the console behind the panel,
    // which is also how a token that was missed gets found.
    //
    // Driven through state rather than a bare spy: this is a controlled
    // component, so a spy that never feeds the new tenant back leaves the field
    // showing its original value and every keystroke computing from that.
    function Harness() {
      const [tenant, setTenant] = useState<Tenant>(acme);
      return (
        <ThemeProvider theme={THEME}>
          <ThemeEditor
            open
            onClose={vi.fn()}
            tenant={tenant}
            onChange={setTenant}
            onReset={vi.fn()}
            domains={DOMAINS}
            darkMode={false}
          />
        </ThemeProvider>
      );
    }
    render(<Harness />);

    const field = screen.getByLabelText('Product name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Northwind');

    expect(field).toHaveValue('Northwind');
  });

  it('offers the subjects the deployment declares', async () => {
    renderEditor();
    await userEvent.click(screen.getByLabelText('Subject'));

    expect(screen.getByRole('option', { name: 'Clinical trials' })).toBeInTheDocument();
  });

  it('says that changing the subject changes more than the colours', () => {
    renderEditor();

    expect(screen.getByText(/which entity types the console offers/)).toBeInTheDocument();
  });

  it('reports a palette that meets AA', () => {
    renderEditor();

    expect(screen.getByText(/Every pair meets WCAG AA/)).toBeInTheDocument();
  });

  it('names the pair that fails, and by how much', () => {
    // The failure this panel exists for: a tenant picks a pale primary, white
    // button text lands below AA, and the product is inaccessible in their own
    // brand through no fault of theirs.
    const pale = { ...acme, palette: { ...acme.palette, primary: '#F5F0A9' } };
    renderEditor(pale);

    expect(screen.getByText(/needs 4.5/)).toBeInTheDocument();
    expect(screen.queryByText(/Every pair meets WCAG AA/)).not.toBeInTheDocument();
  });

  it('says which mode it checked, because a palette can pass in one and fail in the other', () => {
    renderEditor(acme, true);

    expect(screen.getByText(/meets WCAG AA in dark mode/)).toBeInTheDocument();
  });

  it('discards changes rather than remembering a snapshot', async () => {
    const { onReset } = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: /Discard changes/ }));

    expect(onReset).toHaveBeenCalled();
  });

  it('says plainly that nothing is saved', () => {
    // An editor that looks like it persists, and does not, is worse than one
    // that says so.
    renderEditor();

    expect(screen.getByText(/Nothing here is saved/)).toBeInTheDocument();
  });

  it('keeps the heading and the way out outside the scrolling region', () => {
    // Same failure as the retrieval drawer: a panel taller than the window must
    // not be able to scroll its own close button away.
    renderEditor();

    const scroller = screen.getByTestId('theme-editor-scroll');
    expect(scroller).not.toContainElement(screen.getByLabelText('Close theme editor'));
  });
});

describe('without a service behind it', () => {
  it('says why the subject cannot be changed rather than showing an empty control', () => {
    // An empty, disabled select reads as broken. It is not: a mock build has no
    // API to declare what subjects exist.
    render(
      <ThemeProvider theme={THEME}>
        <ThemeEditor
          open
          onClose={vi.fn()}
          tenant={acme}
          onChange={vi.fn()}
          onReset={vi.fn()}
          domains={[]}
          darkMode={false}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/did not list its subjects/)).toBeInTheDocument();
  });
});
