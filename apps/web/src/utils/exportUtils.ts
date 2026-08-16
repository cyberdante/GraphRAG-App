import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Message, GraphData } from '@/types';

export const exportConversationToPDF = (
  messages: Message[],
  conversationId: string,
  brandName = 'Conversation',
) => {
  const doc = new jsPDF();
  
  // Add title
  doc.setFontSize(18);
  doc.text(`${brandName} — Conversation Export`, 14, 20);
  
  // Add conversation ID and date
  doc.setFontSize(10);
  doc.text(`Conversation ID: ${conversationId}`, 14, 30);
  doc.text(`Export Date: ${new Date().toLocaleString()}`, 14, 35);
  
  // Prepare data for table
  const tableData = messages.map((msg, index) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const content = msg.content;
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'N/A';
    
    return [
      index + 1,
      role,
      content,
      timestamp
    ];
  });
  
  // Add table using autoTable
  autoTable(doc, {
    startY: 45,
    head: [['#', 'Role', 'Content', 'Timestamp']],
    body: tableData,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 25 },
      2: { cellWidth: 110 },
      3: { cellWidth: 40 }
    },
    margin: { top: 45 }
  });
  
  // Save the PDF
  doc.save(`conversation-${conversationId}-${Date.now()}.pdf`);
};

export const exportConversationToCSV = (messages: Message[], conversationId: string) => {
  // CSV headers
  const headers = ['Index', 'Role', 'Content', 'Timestamp', 'Citations'];
  
  // CSV rows
  const rows = messages.map((msg, index) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const content = msg.content.replace(/"/g, '""'); // Escape quotes
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'N/A';
    const citations = msg.citations ? msg.citations.map(c => c.source).join('; ') : '';
    
    return [
      index + 1,
      role,
      `"${content}"`,
      timestamp,
      `"${citations}"`
    ];
  });
  
  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `conversation-${conversationId}-${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportGraphToCSV = (graphData: GraphData, conversationId: string) => {
  // Export nodes
  const nodeHeaders = ['ID', 'Label', 'Type', 'Color'];
  const nodeRows = graphData.nodes.map(node => [
    node.id,
    `"${node.label}"`,
    node.type || 'Unknown',
    node.color || ''
  ]);
  
  const nodesCsv = [
    nodeHeaders.join(','),
    ...nodeRows.map(row => row.join(','))
  ].join('\n');
  
  // Export links - handle both string IDs and object references
  const linkHeaders = ['Source', 'Target', 'Label'];
  const linkRows = graphData.links.map(link => {
    const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
    const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
    return [
      sourceId,
      targetId,
      `"${link.label || ''}"`
    ];
  });
  
  const linksCsv = [
    linkHeaders.join(','),
    ...linkRows.map(row => row.join(','))
  ].join('\n');
  
  // Create combined CSV with sections
  const combinedCsv = `# Nodes\n${nodesCsv}\n\n# Links\n${linksCsv}`;
  
  // Create blob and download
  const blob = new Blob([combinedCsv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `graph-${conversationId}-${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportGraphToJsonLD = (graphData: GraphData, conversationId: string) => {
  if (!graphData.jsonLD) {
    alert('No JSON-LD data available');
    return;
  }

  // Create formatted JSON-LD
  const jsonLDString = JSON.stringify(graphData.jsonLD, null, 2);
  
  // Create blob and download
  const blob = new Blob([jsonLDString], { type: 'application/ld+json;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `graph-jsonld-${conversationId}-${Date.now()}.json`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportGraphToPDF = (
  graphData: GraphData,
  conversationId: string,
  brandName = 'Knowledge Graph',
) => {
  const doc = new jsPDF();
  
  // Add title
  doc.setFontSize(18);
  doc.text(`${brandName} — Knowledge Graph Export`, 14, 20);
  
  // Add metadata
  doc.setFontSize(10);
  doc.text(`Conversation ID: ${conversationId}`, 14, 30);
  doc.text(`Export Date: ${new Date().toLocaleString()}`, 14, 35);
  doc.text(`Nodes: ${graphData.nodes.length} | Links: ${graphData.links.length}`, 14, 40);
  
  // Add nodes table
  const nodeData = graphData.nodes.map((node, index) => [
    index + 1,
    node.id,
    node.label,
    node.type || 'Unknown'
  ]);
  
  autoTable(doc, {
    startY: 50,
    head: [['#', 'ID', 'Label', 'Type']],
    body: nodeData,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 30 },
      2: { cellWidth: 80 },
      3: { cellWidth: 40 }
    }
  });
  
  // Get the final Y position after the nodes table
  const finalY = (doc as any).lastAutoTable.finalY || 50;
  
  // Add links table on a new page if needed
  if (finalY > 200) {
    doc.addPage();
  }
  
  // Handle both string IDs and object references in links
  const linkData = graphData.links.map((link, index) => {
    const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
    const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
    return [
      index + 1,
      sourceId,
      targetId,
      link.label || 'N/A'
    ];
  });
  
  autoTable(doc, {
    startY: finalY > 200 ? 20 : finalY + 10,
    head: [['#', 'Source', 'Target', 'Relationship']],
    body: linkData,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [220, 0, 78], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 50 },
      2: { cellWidth: 50 },
      3: { cellWidth: 70 }
    }
  });
  
  // Save the PDF
  doc.save(`graph-${conversationId}-${Date.now()}.pdf`);
};