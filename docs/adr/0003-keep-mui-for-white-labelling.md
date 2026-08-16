# 3. Keep MUI; the white-label ceiling is our own code

Date: 2026-08-16

## Status

Accepted.

## Context

White-labelling is the product's central proposition, not a finishing touch, so
the styling foundation had to be settled before more UI was written against it.
The suspicion was that Material Design's visual signature — corner radius,
elevation, ripple, the 8px density grid, Roboto — would show through any amount
of retheming, and that reaching a genuinely neutral baseline meant migrating to
Tailwind with shadcn/ui, or to headless primitives.

Rather than argue it, we measured it. Three tenant themes were built on the
existing app using nothing but MUI's theme object: stock Material as a control,
an industrial one (square corners, flat, dense, uppercase tracked labels, amber),
and an editorial one (serif, high radius, generous spacing, violet). Each was
screenshotted mid-answer with the graph populated. The experiment lives on the
unmerged `experiment/mui-ceiling` branch.

## Decision

Keep MUI. Do not migrate.

The two non-Material themes did not read as Material. Squaring the radius,
flattening every elevation to `none`, disabling the ripple, changing the type
family and scale, and altering `spacing()` produced interfaces that look like
different products — the industrial one fits visibly more content in the same
viewport, and the editorial one reads as a document rather than a console.
MUI's `components` overrides are, in practice, exactly the per-tenant variant
mechanism that white-labelling requires.

The experiment also found the real constraint, which is not MUI. **Seventeen
hardcoded colours, every one of them in `D3GraphVisualization.tsx`, plus fifteen
node colours baked into the fixture data.** The graph panel is the centrepiece of
the product and it rendered identically under all three tenants, because its
background, node fills, link strokes and label colours never consult the theme.

## Consequences

The migration day is not spent. Effort moves instead to the token layer and to
removing those hardcoded values, which is what actually raises the ceiling.

Two arguments for Tailwind survive this experiment untouched, and should not be
mistaken for having been answered: the bundle and install weight (`@mui/material`
is 13 MB installed, `@mui/icons-material` 172 MB for roughly twenty icons), and
owning the component source outright rather than depending on it. Both are real.
Neither is a white-label argument, which is what this decision was about.

Two things remain untested. Tenant-supplied CSS overrides — "L4" — were not
attempted, and MUI's DOM structure and generated emotion class names are a
genuine obstacle there; if that level is ever required, this decision should be
revisited rather than assumed. And MUI's floating-label input animation, one of
Material's more recognisable behaviours, is not exercised because the app uses
no labelled inputs.

Contrast safety, meanwhile, is now an argument *for* MUI: `getContrastText`
derives an accessible foreground from an arbitrary tenant colour. On Tailwind
that is OKLCH lightness maths we would have written ourselves.
