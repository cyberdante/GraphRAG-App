import React, { useState } from 'react';
import {
  Box,
  Button,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';

export interface TenantOption {
  id: string;
  name: string;
  /** Shown as a swatch, so the list previews what choosing it does. */
  color: string;
}

interface TenantSwitcherProps {
  options: TenantOption[];
  currentId: string;
  onSelect: (id: string) => void;
  busy?: boolean;
}

/**
 * Switches the whole console between brands, live.
 *
 * This is a demo affordance, not a product feature — see `switcherEnabled`.
 * A real client must never be shown a list of other people's brands, so it is
 * off unless a deployment turns it on.
 *
 * It exists because white-labelling is hard to describe and trivial to
 * demonstrate: one click changes the palette, the corner radius, the spacing,
 * the type, the graph colours and the wording at once.
 */
export const TenantSwitcher: React.FC<TenantSwitcherProps> = ({
  options,
  currentId,
  onSelect,
  busy,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const current = options.find((option) => option.id === currentId);

  const choose = (id: string) => {
    setAnchorEl(null);
    if (id !== currentId) onSelect(id);
  };

  return (
    <>
      <Tooltip title="Preview another brand">
        <span>
          <Button
            onClick={(event) => setAnchorEl(event.currentTarget)}
            disabled={busy}
            color="inherit"
            aria-haspopup="menu"
            aria-expanded={Boolean(anchorEl)}
            aria-label={`Brand: ${current?.name ?? currentId}. Preview another brand`}
            endIcon={<ExpandMoreIcon />}
            startIcon={<Swatch color={current?.color ?? 'transparent'} />}
            sx={{ textTransform: 'none', color: 'text.secondary' }}
          >
            <Typography variant="body2" component="span">
              {current?.name ?? currentId}
            </Typography>
          </Button>
        </span>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{ list: { 'aria-label': 'Brand' } }}
      >
        <Typography
          variant="caption"
          sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}
        >
          Same build, different tenant
        </Typography>
        {options.map((option) => (
          <MenuItem
            key={option.id}
            // menuitemradio, not menuitem: exactly one brand is active, and
            // MUI's `selected` only styles the row — assistive technology is
            // told nothing by it.
            role="menuitemradio"
            aria-checked={option.id === currentId}
            selected={option.id === currentId}
            onClick={() => choose(option.id)}
          >
            <Box sx={{ mr: 1.5, display: 'flex' }}>
              <Swatch color={option.color} />
            </Box>
            <ListItemText primary={option.name} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

const Swatch: React.FC<{ color: string }> = ({ color }) => (
  <Box
    aria-hidden
    sx={{
      width: 14,
      height: 14,
      bgcolor: color,
      borderRadius: '50%',
      border: 1,
      borderColor: 'divider',
      flexShrink: 0,
    }}
  />
);
