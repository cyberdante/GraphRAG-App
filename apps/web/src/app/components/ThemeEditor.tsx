import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Close as CloseIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import type { DomainInfo, Tenant } from '@ragstone/shared';
import { auditContrast, buildTheme } from '@/theme';
import { toTenantDocument } from '@/utils/tenantExport';

interface ThemeEditorProps {
  open: boolean;
  onClose: () => void;
  tenant: Tenant;
  onChange: (tenant: Tenant) => void;
  onReset: () => void;
  domains: readonly DomainInfo[];
  darkMode: boolean;
}

/**
 * Editing the brand against the running console.
 *
 * White-labelling is the proposition, and until now it was only assertable: a
 * tenant document was written by hand, and whether the result was readable was
 * discovered by a client. This edits the live tenant, so every change is
 * visible in the app behind it immediately — which is also the fastest way to
 * find a token that was missed, because anything that fails to change is
 * hardcoded somewhere.
 *
 * The contrast panel is the part that earns its place. A tenant picking a pale
 * yellow primary gets white button text at 1.9:1 and an inaccessible product in
 * their own brand, through no fault of their own. The ratios are computed from
 * the theme this very edit produces, so the warning arrives while the colour is
 * still being chosen rather than after a deployment.
 */
export const ThemeEditor: React.FC<ThemeEditorProps> = ({
  open,
  onClose,
  tenant,
  onChange,
  onReset,
  domains,
  darkMode,
}) => {
  const [copied, setCopied] = useState(false);

  // Audited against the theme this edit produces, not against the raw values:
  // dark mode adapts a tenant's colours, so the ratio that matters is the one
  // after adaptation.
  const issues = useMemo(() => {
    const theme = buildTheme(tenant, darkMode);
    return auditContrast([
      {
        label: 'Button label on a primary button',
        foreground: theme.palette.primary.contrastText,
        background: theme.palette.primary.main,
      },
      {
        label: 'Button label on a secondary button',
        foreground: theme.palette.secondary.contrastText,
        background: theme.palette.secondary.main,
      },
      { label: 'Body text on the page', foreground: theme.palette.text.primary, background: theme.palette.background.default },
      { label: 'Body text on a card', foreground: theme.palette.text.primary, background: theme.palette.background.paper },
      { label: 'Brand colour as text', foreground: theme.palette.primary.main, background: theme.palette.background.paper },
    ]);
  }, [tenant, darkMode]);

  const set = <K extends keyof Tenant>(key: K, value: Tenant[K]) =>
    onChange({ ...tenant, [key]: value });

  const setPalette = (key: keyof Tenant['palette'], value: string) =>
    set('palette', { ...tenant.palette, [key]: value });

  const document_ = useMemo(() => JSON.stringify(toTenantDocument(tenant), null, 2), [tenant]);

  const copy = async () => {
    await navigator.clipboard.writeText(document_);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      // Over the app bar, for the reason the retrieval drawer is: the bar is
      // pinned above docked drawers, and a panel whose own heading is behind it
      // cannot be closed.
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 2 }}
      slotProps={{
        paper: { sx: { width: { xs: '100vw', sm: 380 }, height: '100%', display: 'flex', flexDirection: 'column' } },
      }}
    >
      <Box sx={{ p: 2, pb: 0, flexShrink: 0 }} role="group" aria-label="Theme editor">
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">Brand</Typography>
          <IconButton onClick={onClose} aria-label="Close theme editor" size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Every change applies to the console behind this panel. Anything that does not move is
          hardcoded rather than themed.
        </Typography>
        <Divider />
      </Box>

      <Box sx={{ px: 2, pt: 2, pb: 3, overflowY: 'auto', flexGrow: 1 }} data-testid="theme-editor-scroll">
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Identity
        </Typography>
        <TextField
          fullWidth
          size="small"
          label="Product name"
          value={tenant.brand.name}
          onChange={(event) => set('brand', { ...tenant.brand, name: event.target.value })}
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth size="small" sx={{ mb: 3 }} disabled={domains.length === 0}>
          <InputLabel id="domain-label">Subject</InputLabel>
          <Select
            labelId="domain-label"
            label="Subject"
            value={domains.some((entry) => entry.id === tenant.domain) ? tenant.domain : ''}
            onChange={(event) => set('domain', event.target.value || undefined)}
          >
            <MenuItem value="">Deployment default</MenuItem>
            {domains.map((entry) => (
              <MenuItem key={entry.id} value={entry.id}>
                {entry.label}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {domains.length === 0
              ? // An empty, disabled control reads as broken. It is not: there is
                // no service here to declare what subjects exist.
                'The service did not list its subjects, so this cannot be changed here.'
              : 'What the graph is about. Changing it changes which entity types the console offers, not just how they look.'}
          </Typography>
        </FormControl>

        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Colour
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {(['primary', 'secondary', 'background', 'surface'] as const).map((key) => (
            <Stack key={key} direction="row" alignItems="center" spacing={1.5}>
              <Box
                component="input"
                type="color"
                aria-label={key}
                value={tenant.palette[key]}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setPalette(key, event.target.value)
                }
                sx={{ width: 40, height: 32, p: 0, border: 0, background: 'none', cursor: 'pointer' }}
              />
              <Typography variant="body2" sx={{ textTransform: 'capitalize', flexGrow: 1 }}>
                {key}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {tenant.palette[key]}
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Shape and density
        </Typography>
        <Knob
          label="Corner radius"
          value={tenant.shape.radius}
          min={0}
          max={24}
          onChange={(value) => set('shape', { ...tenant.shape, radius: value })}
        />
        <Knob
          label="Spacing"
          value={tenant.density.spacing}
          min={4}
          max={12}
          onChange={(value) => set('density', { ...tenant.density, spacing: value })}
        />
        <Knob
          label="Text scale"
          value={tenant.density.fontScale}
          min={0.85}
          max={1.25}
          step={0.05}
          onChange={(value) => set('density', { ...tenant.density, fontScale: value })}
        />

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Components
        </Typography>
        <Stack spacing={2} sx={{ mb: 3 }}>
          <Choice
            label="Buttons"
            value={tenant.variants.button}
            options={['contained', 'outlined', 'text']}
            onChange={(value) => set('variants', { ...tenant.variants, button: value as Tenant['variants']['button'] })}
          />
          <Choice
            label="Surfaces"
            value={tenant.variants.surface}
            options={['elevated', 'outlined', 'flat']}
            onChange={(value) => set('variants', { ...tenant.variants, surface: value as Tenant['variants']['surface'] })}
          />
        </Stack>

        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Contrast
        </Typography>
        {issues.length === 0 ? (
          <Typography variant="caption" color="success.main" sx={{ display: 'block', mb: 2 }}>
            Every pair meets WCAG AA in {darkMode ? 'dark' : 'light'} mode.
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            {issues.map((issue) => (
              <Typography key={issue.label} variant="caption" color="error.main">
                {issue.label}: {issue.ratio.toFixed(2)}:1, needs {issue.required}
              </Typography>
            ))}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Checked in the mode on screen. Dark surfaces adapt a brand colour, so a palette can pass
          in one mode and fail in the other — switch the theme to see both.
        </Typography>

        <Divider sx={{ mb: 2 }} />
        <Stack spacing={1}>
          <Tooltip title={copied ? 'Copied' : 'Copy the tenant document'} describeChild>
            <Button fullWidth startIcon={<CopyIcon />} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy tenant JSON'}
            </Button>
          </Tooltip>
          <Button fullWidth onClick={onReset}>
            Discard changes
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          The copied document is what a deployment serves from /tenants. Nothing here is saved:
          this edits the brand in front of you, not the one on the server.
        </Typography>
      </Box>
    </Drawer>
  );
};

const Knob: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => (
  <Box sx={{ mb: 2 }}>
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant="body2">{label}</Typography>
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
    <Slider
      value={value}
      min={min}
      max={max}
      step={step}
      size="small"
      aria-label={label}
      onChange={(_event, next) => onChange(Array.isArray(next) ? next[0] : next)}
    />
  </Box>
);

const Choice: React.FC<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <FormControl fullWidth size="small">
    <InputLabel id={`${label}-label`}>{label}</InputLabel>
    <Select
      labelId={`${label}-label`}
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <MenuItem key={option} value={option} sx={{ textTransform: 'capitalize' }}>
          {option}
        </MenuItem>
      ))}
    </Select>
  </FormControl>
);
