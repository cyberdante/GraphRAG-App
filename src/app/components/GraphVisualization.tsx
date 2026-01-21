import React, { useEffect, useRef, useState } from 'react';
import { Box, Paper, Typography, IconButton, Tooltip, Chip, Stack } from '@mui/material';
import {
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  CenterFocusStrong as CenterFocusStrongIcon,
  Fullscreen as FullscreenIcon
} from '@mui/icons-material';
import ForceGraph3D from 'react-force-graph-3d';
import { GraphData } from '@/types';

interface GraphVisualizationProps {
  data: GraphData;
  darkMode: boolean;
}

export const GraphVisualization: React.FC<GraphVisualizationProps> = ({ data, darkMode }) => {
  const fgRef = useRef<any>();
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Clear selected node when data changes or is reset
  useEffect(() => {
    if (data.nodes.length === 0) {
      setSelectedNode(null);
    }
  }, [data]);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const handleZoomIn = () => {
    if (fgRef.current && fgRef.current.cameraPosition) {
      const currentPos = fgRef.current.cameraPosition();
      if (currentPos) {
        fgRef.current.cameraPosition(
          { x: currentPos.x * 0.7, y: currentPos.y * 0.7, z: currentPos.z * 0.7 },
          undefined,
          1000
        );
      }
    }
  };

  const handleZoomOut = () => {
    if (fgRef.current && fgRef.current.cameraPosition) {
      const currentPos = fgRef.current.cameraPosition();
      if (currentPos) {
        fgRef.current.cameraPosition(
          { x: currentPos.x * 1.4, y: currentPos.y * 1.4, z: currentPos.z * 1.4 },
          undefined,
          1000
        );
      }
    }
  };

  const handleCenter = () => {
    if (fgRef.current && fgRef.current.zoomToFit) {
      fgRef.current.zoomToFit(1000, 100);
    }
  };

  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
    if (fgRef.current) {
      // Focus on the clicked node
      const distance = 200;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
      fgRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
        node,
        1000
      );
    }
  };

  const getNodeColor = (node: any) => {
    return node.color || '#69b3a2';
  };

  const getLinkColor = () => {
    return darkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)';
  };

  return (
    <Paper
      elevation={2}
      sx={{
        height: '100%',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: darkMode ? '#0a1929' : '#f5f5f5'
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
          bgcolor: darkMode ? 'rgba(10, 25, 41, 0.9)' : 'rgba(255, 255, 255, 0.9)',
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
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Zoom In">
              <span>
                <IconButton size="small" onClick={handleZoomIn}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Zoom Out">
              <span>
                <IconButton size="small" onClick={handleZoomOut}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Center View">
              <span>
                <IconButton size="small" onClick={handleCenter}>
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
            size="small"
            color="primary"
            variant="outlined"
          />
          <Chip
            label={`${data.links.length} Relationships`}
            size="small"
            color="secondary"
            variant="outlined"
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
        {data.nodes.length > 0 && (
          <ForceGraph3D
            ref={fgRef}
            graphData={data}
            width={dimensions.width}
            height={dimensions.height - 96}
            backgroundColor={darkMode ? '#0a1929' : '#f5f5f5'}
            nodeLabel="label"
            nodeColor={getNodeColor}
            nodeRelSize={6}
            nodeOpacity={0.9}
            linkColor={getLinkColor}
            linkOpacity={0.4}
            linkWidth={1.5}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.004}
            onNodeClick={handleNodeClick}
            enableNodeDrag={true}
            enableNavigationControls={true}
            showNavInfo={false}
          />
        )}
      </Box>

      {/* Selected Node Info */}
      {selectedNode && (
        <Paper
          elevation={4}
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
            <Chip label={selectedNode.type} size="small" color="primary" />
            <Chip label={`ID: ${selectedNode.id}`} size="small" variant="outlined" />
          </Stack>
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
            Click and drag to move • Scroll to zoom • Right-click to rotate
          </Typography>
        </Paper>
      )}
    </Paper>
  );
};