/**
 * The supply-chain vocabulary, mirrored by `apps/api/app/ontology.py`.
 *
 * Node and edge `type` values are terms; this maps each to a real IRI. The
 * previous context declared lowerCamelCase terms while the graph emitted
 * SCREAMING_SNAKE ones, so every predicate fell through to a schema.org IRI
 * that does not exist and the export asserted nothing.
 *
 * Both sides carry a test asserting the vocabulary and the data agree in both
 * directions, so a new relationship cannot go undeclared.
 */

import type { GraphData } from './index';

/** Namespace for classes and properties this project defines itself. */
export const VOCAB = 'https://ragstone.dev/ontology/supply-chain#';

export const SCHEMA = 'https://schema.org/';

/** Node `type` values, mapped to the class IRI each denotes. */
export const CLASSES: Record<string, string> = {
  Supplier: `${VOCAB}Supplier`,
  Shipment: `${VOCAB}Shipment`,
  Product: `${VOCAB}Product`,
  Location: `${VOCAB}Location`,
  Risk: `${VOCAB}Risk`,
  RiskSignal: `${VOCAB}RiskSignal`,
};

/**
 * Edge `type` values, mapped to the property IRI each denotes. Keys are
 * SCREAMING_SNAKE because that is what the graph stores; the IRIs are
 * lowerCamelCase because that is the convention for RDF properties. Aliasing
 * one to the other is what a JSON-LD context is for.
 */
export const PROPERTIES: Record<string, string> = {
  HAS_RISK: `${VOCAB}hasRisk`,
  HAS_SIGNAL: `${VOCAB}hasSignal`,
  INDICATED_BY: `${VOCAB}indicatedBy`,
  SHIPS: `${VOCAB}ships`,
  SUPPLIES: `${VOCAB}supplies`,
  DELIVERED_TO: `${VOCAB}deliveredTo`,
  IN_TRANSIT: `${VOCAB}inTransitTo`,
  IN_SHIPMENT: `${VOCAB}inShipment`,
  /**
   * Fallback for an edge whose type is not in the vocabulary. A term in our own
   * namespace is honest — it says "a relationship we have not named" rather
   * than borrowing someone else's IRI to say it.
   */
  relatedTo: `${VOCAB}relatedTo`,
};

export interface JsonLdDocument {
  '@context': Record<string, unknown>;
  '@graph': Array<Record<string, unknown>>;
}

/**
 * The `@context` for exported graphs. `@vocab` points at our own namespace
 * rather than schema.org, so an undeclared term degrades to an undefined term
 * here instead of falsely claiming one over there.
 */
export function jsonLdContext(): Record<string, unknown> {
  const context: Record<string, unknown> = {
    '@vocab': VOCAB,
    schema: SCHEMA,
    // The one borrowed term, borrowed correctly.
    name: 'schema:name',
    ...CLASSES,
  };

  for (const [term, iri] of Object.entries(PROPERTIES)) {
    context[term] = { '@id': iri, '@type': '@id' };
  }

  return context;
}

/** Renders a graph as a JSON-LD document under the declared vocabulary. */
export function graphToJsonLD(graphData: GraphData): JsonLdDocument {
  const entities = graphData.nodes.map((node) => {
    const relationships: Record<string, string[]> = {};

    for (const link of graphData.links) {
      if (link.source !== node.id) continue;
      const term = link.type in PROPERTIES ? link.type : 'relatedTo';
      (relationships[term] ??= []).push(link.target);
    }

    return {
      '@id': node.id,
      '@type': node.type,
      name: node.label,
      ...relationships,
    };
  });

  return { '@context': jsonLdContext(), '@graph': entities };
}
