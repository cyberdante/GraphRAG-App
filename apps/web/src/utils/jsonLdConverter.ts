import { GraphData, GraphNode, GraphEdge } from '@/types';

/**
 * Converts graph data to JSON-LD format
 */
export function graphToJsonLD(graphData: GraphData): any {
  const entities = graphData.nodes.map((node: GraphNode) => {
    // Find all outgoing relationships for this node
    const relationships: any = {};
    
    graphData.links.forEach((link: GraphEdge) => {
      const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      
      if (sourceId === node.id) {
        const relationshipType = link.type || link.label || 'relatedTo';
        if (!relationships[relationshipType]) {
          relationships[relationshipType] = [];
        }
        relationships[relationshipType].push({
          '@id': targetId
        });
      }
    });

    return {
      '@id': node.id,
      '@type': node.type,
      'name': node.label,
      ...relationships
    };
  });

  return {
    '@context': {
      '@vocab': 'https://schema.org/',
      'suppliesTo': 'https://supply-chain.example.org/suppliesTo',
      'ships': 'https://supply-chain.example.org/ships',
      'hasRisk': 'https://supply-chain.example.org/hasRisk',
      'relatedTo': 'https://supply-chain.example.org/relatedTo',
      'Supplier': 'https://supply-chain.example.org/Supplier',
      'Shipment': 'https://supply-chain.example.org/Shipment',
      'RiskSignal': 'https://supply-chain.example.org/RiskSignal',
      'Port': 'https://supply-chain.example.org/Port',
      'Product': 'https://supply-chain.example.org/Product'
    },
    '@graph': entities
  };
}
