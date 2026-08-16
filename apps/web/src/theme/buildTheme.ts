/**
 * Tenant document to MUI theme.
 *
 * The single place a tenant's declared properties become interface. Components
 * read the theme; nothing reads a tenant directly, and nothing hardcodes a
 * colour. See ADR 0003 for why this is expressed through MUI rather than a
 * migration.
 */

import { createTheme, type Theme, type ThemeOptions } from '@mui/material';
import type { Tenant, TenantVariants } from '@ragstone/shared';
import { readableOn } from './contrast';

/** Every Material elevation flattened; borders or nothing carry separation. */
const NO_SHADOWS = Array(25).fill('none') as ThemeOptions['shadows'];

/** Dark-mode surfaces derived from the tenant rather than a second palette. */
const DARK_BACKGROUND = '#0B1116';
const DARK_SURFACE = '#141D24';
const DARK_DIVIDER = '#233039';

/** Whether this surface treatment draws its own shadows. */
const isElevated = (variants: TenantVariants) => variants.surface === 'elevated';

export function buildTheme(tenant: Tenant, darkMode: boolean): Theme {
  const { palette, shape, density, typography, variants } = tenant;

  const background = darkMode ? DARK_BACKGROUND : palette.background;
  const surface = darkMode ? DARK_SURFACE : palette.surface;
  const divider = darkMode ? DARK_DIVIDER : palette.divider;

  const scale = (rem: number) => `${(rem * density.fontScale).toFixed(3)}rem`;

  // 'outlined' draws a border; 'flat' draws nothing at all and relies on the
  // surface colour differing from the page.
  const surfaceBorder =
    variants.surface === 'outlined' ? { border: `${shape.borderWidth}px solid ${divider}` } : {};

  return createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      // contrastText is derived, not declared: a tenant supplies a brand
      // colour and gets a readable foreground whatever they pick.
      primary: { main: palette.primary, contrastText: readableOn(palette.primary) },
      secondary: { main: palette.secondary, contrastText: readableOn(palette.secondary) },
      success: { main: palette.success },
      warning: { main: palette.warning },
      error: { main: palette.error },
      background: { default: background, paper: surface },
      divider,
    },

    shape: { borderRadius: shape.radius },
    spacing: density.spacing,
    ...(isElevated(variants) ? {} : { shadows: NO_SHADOWS }),

    typography: {
      fontFamily: typography.fontFamily,
      h6: {
        fontFamily: typography.displayFamily ?? typography.fontFamily,
        fontWeight: typography.headingWeight,
        letterSpacing: typography.letterSpacing,
        fontSize: scale(1.15),
      },
      subtitle2: { fontWeight: typography.headingWeight },
      body1: { fontSize: scale(0.95) },
      body2: { fontSize: scale(0.85) },
      caption: { fontSize: scale(0.75) },
      button: {
        textTransform: typography.buttonTextTransform,
        letterSpacing: typography.letterSpacing,
        fontWeight: 600,
      },
    },

    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: variants.interaction === 'flat' },
      },
      MuiButton: {
        defaultProps: { variant: variants.button, size: variants.controlSize },
      },
      MuiTextField: {
        defaultProps: { variant: variants.input, size: variants.controlSize },
      },
      MuiChip: {
        defaultProps: { variant: variants.chip, size: variants.controlSize },
        styleOverrides: { root: { borderRadius: shape.radius, fontWeight: 600 } },
      },
      MuiIconButton: {
        defaultProps: { size: variants.controlSize },
        // A square tenant should not keep circular buttons; a round one should.
        styleOverrides: { root: { borderRadius: shape.radius === 0 ? 0 : undefined } },
      },
      MuiPaper: {
        ...(isElevated(variants) ? {} : { defaultProps: { elevation: 0 } }),
        styleOverrides: { root: surfaceBorder },
      },
      MuiAppBar: {
        ...(isElevated(variants) ? {} : { defaultProps: { elevation: 0 } }),
        styleOverrides: {
          root: isElevated(variants)
            ? {}
            : { borderBottom: `${shape.borderWidth}px solid ${divider}` },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: shape.radius },
          notchedOutline: { borderWidth: shape.borderWidth },
        },
      },
      MuiFilledInput: {
        styleOverrides: { root: { borderRadius: shape.radius } },
      },
    },
  });
}
