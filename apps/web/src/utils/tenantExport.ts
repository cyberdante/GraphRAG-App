import type { Tenant } from '@ragstone/shared';

/**
 * A tenant, as the document a deployment serves from `/tenants`.
 *
 * The editor is only worth having if what it hands back is what actually gets
 * deployed. So this produces the same shape `parseTenant` reads — round-tripped
 * by a test, because an editor that emits a document the parser then repairs is
 * an editor that quietly lies about what it made.
 *
 * `id` is included even though the filename carries it: a document that does
 * not say which tenant it is becomes unattributable the moment it is copied
 * into a ticket, which is exactly where these end up.
 */
export function toTenantDocument(tenant: Tenant): Record<string, unknown> {
  return {
    id: tenant.id,
    ...(tenant.domain ? { domain: tenant.domain } : {}),
    brand: {
      name: tenant.brand.name,
      initials: tenant.brand.initials,
      ...(tenant.brand.logoUrl ? { logoUrl: tenant.brand.logoUrl } : {}),
      ...(tenant.brand.footerText ? { footerText: tenant.brand.footerText } : {}),
    },
    palette: { ...tenant.palette },
    shape: { ...tenant.shape },
    variants: { ...tenant.variants },
    density: { ...tenant.density },
    typography: {
      ...tenant.typography,
      ...(tenant.typography.displayFamily ? { displayFamily: tenant.typography.displayFamily } : {}),
    },
    copy: {
      inputPlaceholder: tenant.copy.inputPlaceholder,
      welcome: tenant.copy.welcome,
      starters: [...tenant.copy.starters],
    },
    graph: {
      nodeColors: { ...tenant.graph.nodeColors },
      defaultNode: tenant.graph.defaultNode,
      ...(tenant.graph.background ? { background: tenant.graph.background } : {}),
    },
  };
}
