import { describe, expect, it } from 'vitest';
import { acme, lumen, meridian, parseTenant } from '@/theme';
import { toTenantDocument } from './tenantExport';

describe('the document the editor hands back', () => {
  /**
   * The property that decides whether the editor is honest.
   *
   * It shows a preview and offers a document. If the document, once parsed by
   * the same code a deployment uses, produces a different tenant from the one
   * previewed, then the editor lied about what it made — and the failure would
   * surface as a client's console looking wrong after a deploy that "matched
   * the preview".
   */
  it.each([
    ['acme', acme],
    ['meridian', meridian],
    ['lumen', lumen],
  ])('round-trips %s through the parser unchanged', (_name, tenant) => {
    const { tenant: parsed, issues } = parseTenant(toTenantDocument(tenant), acme);

    expect(parsed).toEqual(tenant);
    // A repair means the parser had to correct the editor's output.
    expect(issues.filter((issue) => issue.level === 'repaired')).toEqual([]);
  });

  it('round-trips an edited tenant, not just a bundled one', () => {
    const edited = {
      ...acme,
      brand: { ...acme.brand, name: 'Edited Co' },
      palette: { ...acme.palette, primary: '#123456' },
      shape: { ...acme.shape, radius: 0 },
      variants: { ...acme.variants, button: 'text' as const },
    };

    expect(parseTenant(toTenantDocument(edited), acme).tenant).toEqual(edited);
  });

  it('carries the subject, so a pack survives the copy', () => {
    const document = toTenantDocument(lumen);

    expect(document.domain).toBe('clinical-trials');
    expect(parseTenant(document, acme).tenant.domain).toBe('clinical-trials');
  });

  it('names which tenant it is', () => {
    // These end up pasted into tickets, where a document that does not say
    // which tenant it is becomes unattributable.
    expect(toTenantDocument(acme).id).toBe('acme');
  });

  it('omits optional fields rather than emitting empty ones', () => {
    // An empty string for a logo is not "no logo" to a parser that repairs
    // rather than rejects; it is a value to be checked and complained about.
    const bare = { ...acme, brand: { name: 'Bare', initials: 'BA' } };
    const brand = toTenantDocument(bare).brand as Record<string, unknown>;

    expect('logoUrl' in brand).toBe(false);
    expect('footerText' in brand).toBe(false);
  });

  it('copies collections rather than sharing them', () => {
    // The document is handed to JSON.stringify and to a clipboard; a shared
    // reference would let a later edit rewrite a document already copied.
    const document = toTenantDocument(acme);
    (document.graph as { nodeColors: Record<string, string> }).nodeColors.Supplier = '#000000';

    expect(acme.graph.nodeColors.Supplier).not.toBe('#000000');
  });
});
