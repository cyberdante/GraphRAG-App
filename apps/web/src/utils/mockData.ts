import type { Citation, GraphData } from '@/types';

// Supply Chain Mock Data
export const supplyChainGraphData: GraphData = {
  nodes: [
    { id: 'sup_88', label: 'ITAMCO', type: 'Supplier', group: 1, color: '#4CAF50' },
    { id: 'sup_45', label: 'TechParts Inc', type: 'Supplier', group: 1, color: '#4CAF50' },
    { id: 'sup_23', label: 'GlobalMfg', type: 'Supplier', group: 1, color: '#4CAF50' },
    { id: 'risk_12', label: 'Delivery Delay', type: 'Risk', group: 2, color: '#F44336' },
    { id: 'risk_34', label: 'Quality Issues', type: 'Risk', group: 2, color: '#F44336' },
    { id: 'risk_56', label: 'Price Volatility', type: 'Risk', group: 2, color: '#FF9800' },
    { id: 'ship_01', label: 'Shipment #2401', type: 'Shipment', group: 3, color: '#2196F3' },
    { id: 'ship_02', label: 'Shipment #2402', type: 'Shipment', group: 3, color: '#2196F3' },
    { id: 'ship_03', label: 'Shipment #2403', type: 'Shipment', group: 3, color: '#2196F3' },
    { id: 'prod_10', label: 'Component A', type: 'Product', group: 4, color: '#9C27B0' },
    { id: 'prod_11', label: 'Component B', type: 'Product', group: 4, color: '#9C27B0' },
    { id: 'warehouse_1', label: 'Warehouse CA', type: 'Location', group: 5, color: '#607D8B' },
    { id: 'warehouse_2', label: 'Warehouse TX', type: 'Location', group: 5, color: '#607D8B' },
    { id: 'signal_1', label: 'Late Shipments', type: 'RiskSignal', group: 6, color: '#FF5722' },
    { id: 'signal_2', label: 'Low Stock Alert', type: 'RiskSignal', group: 6, color: '#FF5722' }
  ],
  links: [
    { source: 'sup_88', target: 'risk_12', type: 'HAS_RISK', label: 'affected by' },
    { source: 'sup_88', target: 'ship_01', type: 'SHIPS', label: 'shipped' },
    { source: 'sup_45', target: 'risk_34', type: 'HAS_RISK', label: 'affected by' },
    { source: 'sup_45', target: 'ship_02', type: 'SHIPS', label: 'shipped' },
    { source: 'sup_23', target: 'risk_56', type: 'HAS_RISK', label: 'affected by' },
    { source: 'ship_01', target: 'warehouse_1', type: 'DELIVERED_TO', label: 'delivered to' },
    { source: 'ship_02', target: 'warehouse_2', type: 'DELIVERED_TO', label: 'delivered to' },
    { source: 'ship_03', target: 'warehouse_1', type: 'IN_TRANSIT', label: 'in transit to' },
    { source: 'prod_10', target: 'ship_01', type: 'IN_SHIPMENT', label: 'included in' },
    { source: 'prod_11', target: 'ship_02', type: 'IN_SHIPMENT', label: 'included in' },
    { source: 'risk_12', target: 'signal_1', type: 'INDICATED_BY', label: 'indicated by' },
    { source: 'warehouse_1', target: 'signal_2', type: 'HAS_SIGNAL', label: 'has signal' },
    { source: 'sup_88', target: 'prod_10', type: 'SUPPLIES', label: 'supplies' },
    { source: 'sup_45', target: 'prod_11', type: 'SUPPLIES', label: 'supplies' }
  ]
};

export const mockResponses = {
  'suppliers at risk': {
    text: `Based on the current supply chain analysis, the following suppliers are at risk in Q1 2026:

**1. ITAMCO (Supplier ID: sup_88)**
- **Risk Level**: High
- **Primary Risk**: Delivery delays averaging 5-7 days
- **Impact**: Affects Component A production timeline
- **Mitigation**: Alternative supplier identified (TechParts Inc)

**2. TechParts Inc (Supplier ID: sup_45)**
- **Risk Level**: Medium
- **Primary Risk**: Quality control issues reported in last 3 shipments
- **Impact**: 12% rejection rate on Component B
- **Mitigation**: Enhanced QA protocol implemented

**3. GlobalMfg (Supplier ID: sup_23)**
- **Risk Level**: Medium-Low
- **Primary Risk**: Price volatility due to raw material costs
- **Impact**: 8-15% cost increase projected
- **Mitigation**: Long-term contract negotiation in progress

**Recommendations:**
- Diversify supplier base for Component A
- Implement real-time quality monitoring for TechParts Inc
- Lock in pricing with GlobalMfg before Q2 2026`,
    citations: [
      { id: 'c1', source: 'Risk Assessment DB', text: 'Delivery delay pattern identified', confidence: 0.92 },
      { id: 'c2', source: 'Quality Reports', text: 'Component B rejection rate data', confidence: 0.88 },
      { id: 'c3', source: 'Market Analysis', text: 'Raw material price trends', confidence: 0.85 }
    ]
  },
  'shipment status': {
    text: `**Current Shipment Status Overview:**

📦 **Shipment #2401** (In Transit)
- Supplier: ITAMCO
- Destination: Warehouse CA
- ETA: January 24, 2026
- Contents: Component A (500 units)
- Status: ⚠️ Delayed (2 days behind schedule)

📦 **Shipment #2402** (Delivered)
- Supplier: TechParts Inc  
- Destination: Warehouse TX
- Delivered: January 20, 2026
- Contents: Component B (750 units)
- Status: ✅ Completed

📦 **Shipment #2403** (Scheduled)
- Supplier: GlobalMfg
- Destination: Warehouse CA
- ETA: January 28, 2026
- Contents: Mixed components (1,200 units)
- Status: 🔄 On Schedule

**Overall Health**: 67% on-time performance this week`,
    citations: [
      { id: 'c4', source: 'Logistics System', text: 'Real-time shipment tracking', confidence: 0.95 },
      { id: 'c5', source: 'Warehouse Management', text: 'Delivery confirmations', confidence: 0.98 }
    ]
  },
  'inventory levels': {
    text: `**Current Inventory Status by Location:**

🏭 **Warehouse CA** (California)
- Component A: 2,450 units (⚠️ Below reorder point)
- Component B: 3,800 units (✅ Optimal)
- Available Space: 65% utilized
- Last Updated: 2 hours ago

🏭 **Warehouse TX** (Texas)
- Component A: 4,200 units (✅ Optimal)
- Component B: 1,850 units (⚠️ Low stock alert)
- Available Space: 78% utilized  
- Last Updated: 30 minutes ago

**Alerts:**
- Component A at Warehouse CA needs replenishment (Est. 5 days until stockout)
- Component B at Warehouse TX approaching minimum threshold

**Action Items:**
- Expedite Shipment #2401 to Warehouse CA
- Schedule emergency order for Component B to Warehouse TX`,
    citations: [
      { id: 'c6', source: 'Inventory Management System', text: 'Real-time stock levels', confidence: 0.96 },
      { id: 'c7', source: 'Predictive Analytics', text: 'Stockout probability calculations', confidence: 0.87 }
    ]
  }
};

export const generateMockResponse = (query: string): { text: string; citations: Citation[] } => {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('risk') || lowerQuery.includes('supplier')) {
    return mockResponses['suppliers at risk'];
  } else if (lowerQuery.includes('shipment') || lowerQuery.includes('delivery')) {
    return mockResponses['shipment status'];
  } else if (lowerQuery.includes('inventory') || lowerQuery.includes('stock')) {
    return mockResponses['inventory levels'];
  }
  
  // Default response
  return {
    text: `I've analyzed your query about "${query}" in the context of the supply chain knowledge graph. 

The graph contains ${supplyChainGraphData.nodes.length} entities including suppliers, shipments, products, and risk indicators. Based on the current data:

- **3 Active Suppliers**: ITAMCO, TechParts Inc, GlobalMfg
- **3 Tracked Shipments**: Various stages (in-transit, delivered, scheduled)
- **Multiple Risk Factors**: Delivery delays, quality issues, price volatility
- **2 Warehouse Locations**: California and Texas

For more specific information, try asking about:
- Supplier risks and performance
- Shipment status and tracking
- Inventory levels and alerts
- Risk mitigation strategies`,
    citations: [
      { id: 'c_default', source: 'Knowledge Graph', text: 'Entity relationship data', confidence: 0.90 }
    ]
  };
};
