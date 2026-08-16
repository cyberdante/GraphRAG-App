import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Tooltip,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import type { TenantBrand } from '@ragstone/shared';
import {
  Menu as MenuIcon,
  Brightness4 as DarkModeIcon,
  Brightness7 as LightModeIcon,
  Add as AddIcon,
  FileDownload as DownloadIcon,
  PictureAsPdf as PdfIcon,
  TableChart as CsvIcon,
  Code as JsonIcon
} from '@mui/icons-material';

interface NavbarProps {
  brand: TenantBrand;
  onMenuClick: () => void;
  darkMode: boolean;
  onThemeToggle: () => void;
  onNewChat: () => void;
  onExportPDF?: () => void;
  onExportCSV?: () => void;
  onExportGraphPDF?: () => void;
  onExportGraphCSV?: () => void;
  onExportGraphJsonLD?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  brand, 
  onMenuClick, 
  darkMode, 
  onThemeToggle, 
  onNewChat,
  onExportPDF,
  onExportCSV,
  onExportGraphPDF,
  onExportGraphCSV,
  onExportGraphJsonLD
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const exportMenuOpen = Boolean(anchorEl);

  const handleExportMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleExportMenuClose = () => {
    setAnchorEl(null);
  };

  const handleExportAction = (action: () => void) => {
    action();
    handleExportMenuClose();
  };

  return (
    <AppBar 
      position="fixed" 
      elevation={1}
      sx={{ 
        zIndex: (theme) => theme.zIndex.drawer + 1,
        bgcolor: darkMode ? 'background.paper' : 'background.default',
        borderBottom: 1,
        borderColor: 'divider'
      }}
    >
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 1,
              bgcolor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mr: 2
            }}
          >
            {brand.logoUrl ? (
              <Box
                component="img"
                src={brand.logoUrl}
                alt={brand.name}
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <Typography
                variant="h6"
                sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}
              >
                {brand.initials}
              </Typography>
            )}
          </Box>
          <Typography 
            variant="h6" 
            component="div" 
            sx={{ 
              color: 'text.primary',
              fontWeight: 600
            }}
          >
            {brand.name}
          </Typography>
        </Box>

        {/* Theme Toggle */}
        <IconButton
          onClick={onThemeToggle}
          sx={{ 
            color: 'text.primary',
            mr: 1
          }}
          aria-label="toggle theme"
        >
          {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>

        {/* New Chat Button */}
        <Tooltip title="New Chat">
          <Button
            onClick={onNewChat}
            sx={{
              color: 'text.primary',
              mr: 1
            }}
            startIcon={<AddIcon />}
          >
            New Chat
          </Button>
        </Tooltip>

        {/* Export Menu */}
        <Tooltip title="Export">
          <Button
            onClick={handleExportMenuClick}
            sx={{
              color: 'text.primary',
              mr: 1
            }}
            startIcon={<DownloadIcon />}
          >
            Export
          </Button>
        </Tooltip>
        <Menu
          anchorEl={anchorEl}
          open={exportMenuOpen}
          onClose={handleExportMenuClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right'
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right'
          }}
        >
          <MenuItem
            onClick={() => handleExportAction(onExportPDF || (() => {}))}
          >
            <ListItemIcon>
              <PdfIcon />
            </ListItemIcon>
            <ListItemText>Export PDF</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleExportAction(onExportCSV || (() => {}))}
          >
            <ListItemIcon>
              <CsvIcon />
            </ListItemIcon>
            <ListItemText>Export CSV</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleExportAction(onExportGraphPDF || (() => {}))}
          >
            <ListItemIcon>
              <PdfIcon />
            </ListItemIcon>
            <ListItemText>Export Graph PDF</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleExportAction(onExportGraphCSV || (() => {}))}
          >
            <ListItemIcon>
              <CsvIcon />
            </ListItemIcon>
            <ListItemText>Export Graph CSV</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleExportAction(onExportGraphJsonLD || (() => {}))}
          >
            <ListItemIcon>
              <JsonIcon />
            </ListItemIcon>
            <ListItemText>Export Graph JSON-LD</ListItemText>
          </MenuItem>
        </Menu>

        {/* Hamburger Menu */}
        <IconButton
          edge="end"
          onClick={onMenuClick}
          sx={{ color: 'text.primary' }}
          aria-label="menu"
        >
          <MenuIcon />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
};