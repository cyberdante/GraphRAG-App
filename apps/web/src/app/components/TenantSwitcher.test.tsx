import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TenantSwitcher, type TenantOption } from './TenantSwitcher';

const options: TenantOption[] = [
  { id: 'acme', name: 'Acme Console', color: '#1976d2' },
  { id: 'meridian', name: 'Meridian Supply', color: '#B45309' },
  { id: 'lumen', name: 'Lumen Intelligence', color: '#4C1D95' },
];

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: /preview another brand/i }));
};

describe('TenantSwitcher', () => {
  it('shows the current brand by name', () => {
    render(<TenantSwitcher options={options} currentId="meridian" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Meridian Supply/ })).toBeInTheDocument();
  });

  it('lists every available brand once opened', async () => {
    render(<TenantSwitcher options={options} currentId="acme" onSelect={vi.fn()} />);
    await open();

    for (const option of options) {
      expect(screen.getByRole('menuitemradio', { name: option.name })).toBeInTheDocument();
    }
  });

  it('reports the chosen brand', async () => {
    const onSelect = vi.fn();
    render(<TenantSwitcher options={options} currentId="acme" onSelect={onSelect} />);
    await open();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Lumen Intelligence' }));

    expect(onSelect).toHaveBeenCalledWith('lumen');
  });

  it('does not reload the brand already showing', async () => {
    // Re-fetching the current tenant would flicker for no reason.
    const onSelect = vi.fn();
    render(<TenantSwitcher options={options} currentId="acme" onSelect={onSelect} />);
    await open();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Acme Console' }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the current brand as selected for assistive technology', async () => {
    render(<TenantSwitcher options={options} currentId="meridian" onSelect={vi.fn()} />);
    await open();

    // menuitemradio is the right role for a one-of-many choice; aria-checked
    // is what conveys which one, since MUI's `selected` only styles it.
    expect(screen.getByRole('menuitemradio', { name: 'Meridian Supply' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('is disabled while a switch is in flight', () => {
    render(<TenantSwitcher options={options} currentId="acme" onSelect={vi.fn()} busy />);
    expect(screen.getByRole('button', { name: /preview another brand/i })).toBeDisabled();
  });

  it('falls back to the id when the current brand is not in the list', () => {
    // A deployment can point at a tenant the bundle has never heard of.
    render(<TenantSwitcher options={options} currentId="unknown" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /unknown/i })).toBeInTheDocument();
  });
});
