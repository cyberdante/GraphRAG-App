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

/** What survives a data change; rebuilt only when the palette or size does. */
interface Scaffold {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  linkLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  linkLabelLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  nodeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  palette: ReturnType<typeof graphPalette>;
  width: number;
  height: number;
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

  /** Node objects kept across frames, so a layout survives a redraw. */
  const nodeStateRef = useRef(new Map<string, SimulationNode>());
  /** The parts of the drawing that outlive a data change. */
  const scaffoldRef = useRef<Scaffold | null>(null);
  /** Whether the view has been fitted once. Re-fitting fights the reader. */
  const fittedRef = useRef(false);

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

  // Main visualization effect.
  //
  // Incremental on purpose. This used to open with `selectAll('*').remove()`
  // and build a fresh simulation on every change, which was survivable only
  // while the graph was small enough to re-solve instantly. The pipeline sends
  // two graph frames per query — a provisional one so there is something to
  // look at while ranking runs, then the real one — so every answer detonated
  // the layout halfway through, and any node the reader had dragged went back
  // where the simulation wanted it.
  //
  // Nodes are therefore kept across frames by id, carrying their position and
  // velocity, and the simulation is reheated rather than replaced. The
  // scaffolding is only torn down when something it cannot be patched for
  // changes: the palette, or the size of the canvas.
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = dimensions.width;
    const height = dimensions.height;

    const scaffold = scaffoldRef.current;
    const reusable =
      scaffold !== null && scaffold.palette === palette && scaffold.width === width && scaffold.height === height;

    if (!reusable) {
      // Clear before any early exit. This used to sit after a `return` on
      // empty data, so deleting a conversation reset the counts to zero while
      // the old drawing stayed on screen — the panel claimed nothing and
      // showed something.
      svg.selectAll('*').remove();
      simulationRef.current?.stop();
      simulationRef.current = null;
      scaffoldRef.current = null;
      nodeStateRef.current.clear();
    }

    if (data.nodes.length === 0) {
      // Drop the drawing but keep the scaffolding: an emptied graph is usually
      // about to be refilled by the next conversation.
      scaffoldRef.current?.linkLayer.selectAll('*').remove();
      scaffoldRef.current?.linkLabelLayer.selectAll('*').remove();
      scaffoldRef.current?.nodeLayer.selectAll('*').remove();
      simulationRef.current?.stop();
      nodeStateRef.current.clear();
      fittedRef.current = false;
      return;
    }

    if (!scaffoldRef.current) {
      const g = svg.append('g');

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

      // Layer order is drawing order: links first so nodes sit on top of them.
      const linkLayer = g.append('g').attr('class', 'links');
      const linkLabelLayer = g.append('g').attr('class', 'link-labels');
      const nodeLayer = g.append('g').attr('class', 'nodes');

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      svg.call(zoom);
      zoomBehaviorRef.current = zoom;

      scaffoldRef.current = { g, linkLayer, linkLabelLayer, nodeLayer, palette, width, height };
    }

    const { g, linkLayer, linkLabelLayer, nodeLayer } = scaffoldRef.current;

    // Reuse the node object for an id we have already placed, so its position
    // and velocity survive. A fresh object each frame is what made the layout
    // restart, however stable the data was.
    const known = nodeStateRef.current;
    const incoming = new Set(data.nodes.map((node) => node.id));
    const isFirstDraw = known.size === 0;

    for (const id of [...known.keys()]) {
      if (!incoming.has(id)) known.delete(id);
    }

    const nodes: SimulationNode[] = data.nodes.map((node) => {
      const existing = known.get(node.id);
      if (existing) {
        // Copy the data, not the position: x, y, vx and vy are the layout's.
        Object.assign(existing, node);
        return existing;
      }
      const created: SimulationNode = { ...node };
      known.set(node.id, created);
      return created;
    });

    // A new node with no position starts wherever d3 puts it, which is a ring
    // around the origin — visibly a long way from the graph it belongs to.
    // Starting it near something it connects to means it settles instead of
    // flying across the canvas and dragging its neighbours with it.
    const placed = nodes.filter((node) => node.x !== undefined);
    for (const node of nodes) {
      if (node.x !== undefined) continue;

      const neighbours = data.links
        .filter((link) => link.source === node.id || link.target === node.id)
        .map((link) => known.get(link.source === node.id ? link.target : link.source))
        .filter((n): n is SimulationNode => n?.x !== undefined);

      const anchors = neighbours.length > 0 ? neighbours : placed;
      if (anchors.length > 0) {
        node.x = anchors.reduce((sum, n) => sum + (n.x ?? 0), 0) / anchors.length + (Math.random() - 0.5) * 40;
        node.y = anchors.reduce((sum, n) => sum + (n.y ?? 0), 0) / anchors.length + (Math.random() - 0.5) * 40;
      }
    }

    const links: SimulationLink[] = data.links.map((link) => ({ ...link }));

    const simulation =
      simulationRef.current ??
      d3.forceSimulation<SimulationNode, SimulationLink>()
        .force('link', d3.forceLink<SimulationNode, SimulationLink>().id((d) => d.id).distance(150))
        .force('charge', d3.forceManyBody().strength(-500))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(40));

    simulationRef.current = simulation;
    simulation.nodes(nodes);
    simulation.force<d3.ForceLink<SimulationNode, SimulationLink>>('link')?.links(links);

    // Keyed so d3 can tell which line is which across frames. Source and
    // target arrive as ids and are rewritten to node objects by forceLink, so
    // the key has to read both forms.
    const endpointId = (end: string | SimulationNode) =>
      typeof end === 'object' ? end.id : end;
    const linkKey = (d: SimulationLink) =>
      `${endpointId(d.source)}->${endpointId(d.target)}:${d.type}`;

    const link = linkLayer
      .selectAll<SVGLineElement, SimulationLink>('line')
      .data(links, linkKey)
      .join((enter) =>
        enter.append('line')
          .attr('stroke', palette.link)
          .attr('stroke-width', 2)
          .attr('marker-end', `url(#${ARROW_MARKER_ID})`),
      );

    const linkLabel = linkLabelLayer
      .selectAll<SVGTextElement, SimulationLink>('text')
      .data(links, linkKey)
      .join((enter) =>
        enter.append('text')
          .attr('class', 'link-label')
          .attr('font-size', '10px')
          .attr('fill', palette.sublabel)
          .attr('text-anchor', 'middle')
          .attr('pointer-events', 'none'),
      )
      .text((d) => d.label || d.type);

    const node = nodeLayer
      .selectAll<SVGGElement, SimulationNode>('g')
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const group = enter.append('g')
          .attr('cursor', 'pointer')
          .call(d3.drag<SVGGElement, SimulationNode>()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended) as any);

        group.append('circle')
          .attr('r', 15)
          // Colour follows the entity type, so a tenant restyles the whole
          // graph by declaring six colours rather than restating them per node.
          .attr('fill', (d) => palette.nodeColor(d.type))
          .attr('stroke', palette.nodeStroke)
          .attr('stroke-width', 2)
          .on('click', (event, d) => {
            event.stopPropagation();
            setSelectedNode(d);
          });

        group.append('text')
          .attr('class', 'node-label')
          .attr('dy', -22)
          .attr('text-anchor', 'middle')
          .attr('font-size', '12px')
          .attr('font-weight', 'bold')
          .attr('fill', palette.label)
          .attr('pointer-events', 'none')
          .style('user-select', 'none');

        group.append('text')
          .attr('class', 'node-type')
          .attr('dy', 25)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', palette.sublabel)
          .attr('pointer-events', 'none')
          .style('user-select', 'none');

        return group;
      });

    // Text is set on the merged selection, so a node whose label changed
    // updates without being torn down and re-placed.
    node.select('.node-label')
      .text((d) => (d as SimulationNode).label)
      .style('display', showLabels ? 'block' : 'none');
    node.select('.node-type').text((d) => (d as SimulationNode).type);

    function dragstarted(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>) {
      if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>) {
      if (!event.active) simulationRef.current?.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimulationNode)?.x ?? 0)
        .attr('y1', (d) => (d.source as SimulationNode)?.y ?? 0)
        .attr('x2', (d) => (d.target as SimulationNode)?.x ?? 0)
        .attr('y2', (d) => (d.target as SimulationNode)?.y ?? 0);

      linkLabel
        .attr('x', (d) => (((d.source as SimulationNode)?.x ?? 0) + ((d.target as SimulationNode)?.x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as SimulationNode)?.y ?? 0) + ((d.target as SimulationNode)?.y ?? 0)) / 2);

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Warm enough to absorb what changed, cool enough not to throw away what
    // is already settled. A full restart (alpha 1) is what the old code did
    // implicitly by building a new simulation every time.
    simulation.alpha(isFirstDraw ? 1 : 0.3).restart();

    // Fit once, when there was nothing to fit before. Re-fitting on every
    // frame fights both the second graph frame of a query and any zoom the
    // reader has chosen since.
    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    if (!fittedRef.current) {
      fittedRef.current = true;
      fitTimer = setTimeout(() => {
        const bounds = g.node()?.getBBox();
        const zoom = zoomBehaviorRef.current;
        if (bounds && zoom && bounds.width > 0 && bounds.height > 0) {
          const scale = 0.8 / Math.max(bounds.width / width, bounds.height / height);
          const midX = bounds.x + bounds.width / 2;
          const midY = bounds.y + bounds.height / 2;

          svg.transition()
            .duration(750)
            .call(
              zoom.transform as any,
              d3.zoomIdentity
                .translate(width / 2 - scale * midX, height / 2 - scale * midY)
                .scale(scale),
            );
        }
      }, 500);
    }

    return () => {
      if (fitTimer) clearTimeout(fitTimer);
    };
  }, [data, palette, dimensions, showLabels]);

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
            <Tooltip title="Zoom In" describeChild>
              <span>
                <IconButton onClick={handleZoomIn} aria-label="Zoom In">
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Zoom Out" describeChild>
              <span>
                <IconButton onClick={handleZoomOut} aria-label="Zoom Out">
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Center View" describeChild>
              <span>
                <IconButton onClick={handleCenter} aria-label="Fit to view">
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