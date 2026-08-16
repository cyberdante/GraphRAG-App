import { CLASSES, PROPERTIES, VOCAB, graphToJsonLD, jsonLdContext } from '@graphrag/shared';
import { describe, expect, it } from 'vitest';
import { supplyChainGraphData } from './mockData';

/**
 * The mock and the service must describe the same world. These mirror
 * apps/api/tests/test_ontology.py: if the two vocabularies drift, the demo
 * exports one set of IRIs and the real service exports another.
 */
describe('ontology', () => {
  describe('the vocabulary covers the mock data', () => {
    const nodeTypes = new Set(supplyChainGraphData.nodes.map((node) => node.type));
    const edgeTypes = new Set(supplyChainGraphData.links.map((link) => link.type));

    it('declares every node type the mock emits', () => {
      const undeclared = [...nodeTypes].filter((type) => !(type in CLASSES));
      expect(undeclared).toEqual([]);
    });

    it('declares every edge type the mock emits', () => {
      const undeclared = [...edgeTypes].filter((type) => !(type in PROPERTIES));
      expect(undeclared).toEqual([]);
    });

    it('has no class declared but never used', () => {
      const unused = Object.keys(CLASSES).filter((term) => !nodeTypes.has(term));
      expect(unused).toEqual([]);
    });

    it('has no property declared but never used', () => {
      // relatedTo is the deliberate fallback for an unmodelled relationship.
      const unused = Object.keys(PROPERTIES).filter(
        (term) => term !== 'relatedTo' && !edgeTypes.has(term),
      );
      expect(unused).toEqual([]);
    });
  });

  describe('the context', () => {
    it('keeps undeclared terms in our own namespace', () => {
      // Pointing @vocab at schema.org was the original bug: unmatched terms
      // silently claimed IRIs like https://schema.org/HAS_RISK, which is not
      // a thing that exists.
      expect(jsonLdContext()['@vocab']).toBe(VOCAB);
    });

    it('declares properties as IRI references', () => {
      expect(jsonLdContext().HAS_RISK).toEqual({ '@id': `${VOCAB}hasRisk`, '@type': '@id' });
    });

    it('borrows only from a real vocabulary', () => {
      expect(jsonLdContext().name).toBe('schema:name');
    });
  });

  describe('the document', () => {
    it('defines every term it uses', () => {
      const doc = graphToJsonLD(supplyChainGraphData);
      const structural = new Set(['@id', '@type']);

      for (const entity of doc['@graph']) {
        for (const term of Object.keys(entity)) {
          if (structural.has(term)) continue;
          expect(doc['@context']).toHaveProperty(term);
        }
      }
    });

    it('renders outgoing edges on their subject', () => {
      const doc = graphToJsonLD(supplyChainGraphData);
      const itamco = doc['@graph'].find((entity) => entity['@id'] === 'sup_88');

      expect(itamco).toMatchObject({
        '@type': 'Supplier',
        name: 'ITAMCO',
        HAS_RISK: ['risk_12'],
      });
    });

    it('falls back rather than inventing a term for an unmodelled edge', () => {
      const doc = graphToJsonLD({
        nodes: [
          { id: 'a', label: 'A', type: 'Supplier', group: 1 },
          { id: 'b', label: 'B', type: 'Product', group: 2 },
        ],
        links: [{ source: 'a', target: 'b', type: 'SOMETHING_NEW' }],
      });
      const a = doc['@graph'].find((entity) => entity['@id'] === 'a');

      expect(a).not.toHaveProperty('SOMETHING_NEW');
      expect(a).toHaveProperty('relatedTo', ['b']);
    });
  });
});
