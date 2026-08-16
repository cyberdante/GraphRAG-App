import React from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import type { BackendInfo } from '@ragstone/shared';
import {
  BOUNDS,
  DEFAULT_SETTINGS,
  isDefault,
  type RetrievalSettings,
} from '@/utils/retrievalSettings';

interface RetrievalControlsProps {
  open: boolean;
  onClose: () => void;
  settings: RetrievalSettings;
  onChange: (settings: RetrievalSettings) => void;
  /** From GET /api/backends. Empty when the service did not answer. */
  backends: BackendInfo[];
  /** The entity types this tenant's domain declares. */
  entityTypes: string[];
  /** Controls stay usable mid-answer, but changes apply to the next query. */
  disabled?: boolean;
}

/**
 * The knobs, and what each one costs.
 *
 * These were compiled in: two hops, 150 nodes, and an entity filter naming
 * three of six classes. An operator tuning retrieval had to edit the source
 * and rebuild.
 *
 * Every control says what it trades. "Top K: 30" means nothing on its own;
 * "how much evidence reaches the model — more is slower and costs more
 * tokens" is the sentence that lets someone decide.
 */
export const RetrievalControls: React.FC<RetrievalControlsProps> = ({
  open,
  onClose,
  settings,
  onChange,
  backends,
  entityTypes,
  disabled = false,
}) => {
  const update = <K extends keyof RetrievalSettings>(
    key: K,
    value: RetrievalSettings[K],
  ) => onChange({ ...settings, [key]: value });

  const toggleType = (type: string) => {
    const next = settings.entityTypes.includes(type)
      ? settings.entityTypes.filter((entry) => entry !== type)
      : [...settings.entityTypes, type];
    update('entityTypes', next);
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 360 }, p: 2 }} role="group" aria-label="Retrieval settings">
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">Retrieval</Typography>
          <IconButton onClick={onClose} aria-label="Close retrieval settings" size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applies to the next question. Nothing here changes an answer already given.
        </Typography>

        <Divider sx={{ mb: 2 }} />

        <FormControl fullWidth size="small" sx={{ mb: 3 }} disabled={backends.length === 0}>
          <InputLabel id="backend-label">Backend</InputLabel>
          <Select
            labelId="backend-label"
            label="Backend"
            value={settings.backend ?? ''}
            onChange={(event) => update('backend', event.target.value || undefined)}
          >
            <MenuItem value="">
              {/* Naming the default beats an empty row that looks like a bug. */}
              Deployment default
              {backends.find((backend) => backend.default)
                ? ` (${backends.find((backend) => backend.default)?.name})`
                : ''}
            </MenuItem>
            {backends.map((backend) => (
              <MenuItem key={backend.name} value={backend.name}>
                {backend.name}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {backends.length === 0
              ? 'The service did not list its backends.'
              : (backends.find((backend) => backend.name === settings.backend)?.description ??
                'Which store answers. A request names a backend, never an endpoint.')}
          </Typography>
        </FormControl>

        <Knob
          label="Evidence to the model"
          hint="How many ranked statements reach the prompt. More is slower and costs more tokens; too few and the answer has nothing to stand on."
          value={settings.topK}
          bounds={BOUNDS.topK}
          onChange={(value) => update('topK', value)}
          disabled={disabled}
        />

        <Knob
          label="Nodes in the picture"
          hint="Caps the subgraph drawn beneath the answer. This is the drawing only — it does not change what the model was told."
          value={settings.maxNodes}
          bounds={BOUNDS.maxNodes}
          step={10}
          onChange={(value) => update('maxNodes', value)}
          disabled={disabled}
        />

        <Knob
          label="Hops"
          hint="How far retrieval walks from what the question names. Two reaches a supplier's shipments; further finds more context and more noise."
          value={settings.maxHops}
          bounds={BOUNDS.maxHops}
          onChange={(value) => update('maxHops', value)}
          disabled={disabled}
        />

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Entity types
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {settings.entityTypes.length === 0
            ? 'Every type. Selecting none searches everything, rather than nothing.'
            : `Only statements touching ${settings.entityTypes.length} of ${entityTypes.length} types.`}
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {entityTypes.map((type) => {
            const selected = settings.entityTypes.includes(type);
            return (
              <Chip
                key={type}
                label={type}
                size="small"
                color={selected ? 'primary' : 'default'}
                onClick={() => toggleType(type)}
                aria-pressed={selected}
              />
            );
          })}
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Button
          fullWidth
          onClick={() => onChange({ ...DEFAULT_SETTINGS })}
          disabled={isDefault(settings)}
        >
          Reset to defaults
        </Button>
      </Box>
    </Drawer>
  );
};

const Knob: React.FC<{
  label: string;
  hint: string;
  value: number;
  bounds: { min: number; max: number };
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}> = ({ label, hint, value, bounds, step = 1, onChange, disabled }) => (
  <Box sx={{ mb: 3 }}>
    <Stack direction="row" alignItems="baseline" justifyContent="space-between">
      <Tooltip title={hint} placement="left">
        <Typography variant="subtitle2" sx={{ cursor: 'help' }}>
          {label}
        </Typography>
      </Tooltip>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
    <Slider
      value={value}
      min={bounds.min}
      max={bounds.max}
      step={step}
      onChange={(_event, next) => onChange(Array.isArray(next) ? next[0] : next)}
      disabled={disabled}
      aria-label={label}
      size="small"
    />
    <Typography variant="caption" color="text.secondary">
      {hint}
    </Typography>
  </Box>
);
