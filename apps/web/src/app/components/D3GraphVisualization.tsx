import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
  useTheme,
  alpha,
} from '@mui/material';
import {
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  CenterFocusStrong as CenterFocusStrongIcon,
} from '@mui/icons-material';
import * as d3 from 'd3';
import type { Tenant } from '@ragstone/shared';
import { graphPalette } from '@/theme';
import { GraphData, GraphNode, GraphEdge } from '@/types';

/** One marker per document; its colour is set from the palette. */
const ARROW_MARKER_ID = 'graph-arrow';

interface D3GraphVisualizationProps {
  data: GraphData;
  tenant: Tenant;
}

interface SimulationNode extends d3.SimulationNodeDatum, GraphNode {
  x?: number;
  y?: number;
}

// d3 rewrites source and target from ids to node objects once the simulation
// starts, so those two fields cannot keep the plain string type GraphEdge uses.
interface SimulationLink
  extends d3.SimulationLinkDatum<SimulationNode>,
    Omit<GraphEdge, 'source' | 'target'> {
  source: string | SimulationNode;
  target: string | SimulationNode;
}

export const D3GraphVisualization: React.FC<D3GraphVisualizationProps> = ({ data, tenant }) => {
  const theme = useTheme();
  // Memoised: the render effect depends on this, and a fresh object every
  // render would tear down and rebuild the simulation continuously.
  const palette = useMemo(() => graphPalette(theme, tenant), [theme, tenant]);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const simulationRef = useRef<d3.Simulation<SimulationNode, SimulationLink> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Clear selected node when data changes or is reset
  useEffect(() => {
    if (data.nodes.length === 0) {
      setSelectedNode(null);
    }
  }, [data]);

  // Update dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height - 96 });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Main visualization effect
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = dimensions.width;
    const height = dimensions.height;

    // Clear before any early exit. This used to sit after a `return` on empty
    // data, so deleting a conversation reset the counts to zero while the old
    // drawing stayed on screen — the panel claimed nothing and showed
    // something.
    svg.selectAll('*').remove();
    simulationRef.current?.stop();

    if (data.nodes.length === 0) return;

    // Create main group for zoom/pan
    const g = svg.append('g');

    // Define arrow markers for directed edges
    svg.append('defs').selectAll('marker')
      .data(['end'])
      .enter().append('marker')
        .attr('id', () => ARROW_MARKER_ID)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', palette.arrow);

    // Prepare data
    const nodes: SimulationNode[] = data.nodes.map(node => ({ ...node }));
    const links: SimulationLink[] = data.links.map(link => ({
      ...link,
      source: link.source,
      target: link.target,
    }));

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimulationNode, SimulationLink>(links)
        .id(d => d.id)
        .distance(150))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    simulationRef.current = simulation;

    // Create links FIRST so they appear behind nodes
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter().append('line')
        .attr('stroke', palette.link)
        .attr('stroke-width', 2)
        .attr('marker-end', `url(#${ARROW_MARKER_ID})`);

    // Create link labels
    const linkLabel = g.append('g')
      .attr('class', 'link-labels')
      .selectAll('text')
      .data(links)
      .enter().append('text')
        .attr('class', 'link-label')
        .attr('font-size', '10px')
        .attr('fill', palette.sublabel)
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none')
        .text(d => d.label || d.type);

    // Create node groups AFTER links
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter().append('g')
        .attr('cursor', 'pointer')
        .call(d3.drag<SVGGElement, SimulationNode>()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended) as any);

    // Add circles to nodes
    node.append('circle')
      .attr('r', 15)
      // Colour follows the entity type, so a tenant restyles the whole graph
      // by declaring six colours rather than restating them per node.
      .attr('fill', d => palette.nodeColor(d.type))
      .attr('stroke', palette.nodeStroke)
      .attr('stroke-width', 2)
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      });

    // Add labels to nodes
    node.append('text')
      .attr('class', 'node-label')
      .attr('dy', -22)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('fill', palette.label)
      .attr('pointer-events', 'none')
      .style('user-select', 'none')
      .text(d => d.label)
      .style('display', showLabels ? 'block' : 'none');

    // Add type badges
    node.append('text')
      .attr('dy', 25)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', palette.sublabel)
      .attr('pointer-events', 'none')
      .style('user-select', 'none')
      .text(d => d.type);

    // Drag functions
    function dragstarted(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    // Update positions on tick
    simulation.on('tick', () => {
      // Update link positions
      link
        .attr('x1', d => {
          const src = d.source as SimulationNode;
          return src?.x ?? 0;
        })
        .attr('y1', d => {
          const src = d.source as SimulationNode;
          return src?.y ?? 0;
        })
        .attr('x2', d => {
          const trg = d.target as SimulationNode;
          return trg?.x ?? 0;
        })
        .attr('y2', d => {
          const trg = d.target as SimulationNode;
          return trg?.y ?? 0;
        });

      // Update link label positions
      linkLabel
        .attr('x', d => {
          const src = d.source as SimulationNode;
          const trg = d.target as SimulationNode;
          return ((src?.x ?? 0) + (trg?.x ?? 0)) / 2;
        })
        .attr('y', d => {
          const src = d.source as SimulationNode;
          const trg = d.target as SimulationNode;
          return ((src?.y ?? 0) + (trg?.y ?? 0)) / 2;
        });

      // Update node positions
      node
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    // Initial zoom to fit - wait for simulation to stabilize a bit
    setTimeout(() => {
      const bounds = g.node()?.getBBox();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const fullWidth = bounds.width;
        const fullHeight = bounds.height;
        const midX = bounds.x + fullWidth / 2;
        const midY = bounds.y + fullHeight / 2;
        
        const scale = 0.8 / Math.max(fullWidth / width, fullHeight / height);
        const translateX = width / 2 - scale * midX;
        const translateY = height / 2 - scale * midY;

        svg.transition()
          .duration(750)
          .call(
            zoom.transform as any,
            d3.zoomIdentity.translate(translateX, translateY).scale(scale)
          );
      }
    }, 500);

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [data, palette, dimensions]);

  // Update label visibility when toggle changes
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('.node-label')
      .style('display', showLabels ? 'block' : 'none');
  }, [showLabels]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomBehaviorRef.current.scaleBy as any, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(300)
        .call(zoomBehaviorRef.current.scaleBy as any, 0.7);
    }
  };

  const handleCenter = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(750)
        .call(
          zoomBehaviorRef.current.transform as any,
          d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(1)
        );
    }
  };

  return (
    <Paper
      sx={{
        height: '100%',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: palette.canvas
      }}
    >
      {/* Header */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          p: 2,
          bgcolor: alpha(theme.palette.background.paper, 0.9),
          backdropFilter: 'blur(8px)',
          zIndex: 10,
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" fontWeight={600}>
            Knowledge Graph Visualization
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              control={
                <Switch
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
              }
              label="Labels"
              sx={{ mr: 2 }}
            />
            <Tooltip title="Zoom In">
              <span>
                <IconButton onClick={handleZoomIn}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Zoom Out">
              <span>
                <IconButton onClick={handleZoomOut}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Center View">
              <span>
                <IconButton onClick={handleCenter}>
                  <CenterFocusStrongIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Box>

        {/* Stats */}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip
            label={`${data.nodes.length} Nodes`}
            color="primary"
          />
          <Chip
            label={`${data.links.length} Relationships`}
            color="secondary"
          />
        </Stack>
      </Box>

      {/* Graph Container */}
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: '100%',
          pt: 12
        }}
      >
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          style={{ display: 'block' }}
        />
      </Box>

      {/* Selected Node Info */}
      {selectedNode && (
        <Paper
          sx={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            p: 2,
            maxWidth: 300,
            zIndex: 10,
            bgcolor: 'background.paper'
          }}
        >
          <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
            {selectedNode.label}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Chip label={selectedNode.type} color="primary" />
            <Chip label={`ID: ${selectedNode.id}`} />
          </Stack>
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
            Click to select • Drag nodes to move • Scroll to zoom • Pan to navigate
          </Typography>
        </Paper>
      )}
    </Paper>
  );
};