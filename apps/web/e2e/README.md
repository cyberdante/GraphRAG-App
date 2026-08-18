# Browser checks

The suite that runs in a browser, because the one that does not cannot see.

Four defects reached a person before they reached a test: a settings drawer
opening behind the app bar, near-black button text at 4.19:1, a read-only chip
styled as a control, and shipped-versus-blocking encoded in red against green.
Every one passed the unit suite and always would have — jsdom does no layout and
has no opinion about perception.

```bash
pnpm e2e              # run everything
pnpm e2e:baselines    # regenerate screenshots in the CI container
```

Regenerate baselines through `pnpm e2e:baselines`, never `--update-snapshots`
directly: the script builds on the host and photographs inside
`mcr.microsoft.com/playwright:v1.62.1-noble`, which is the image CI runs in.
Screenshots taken on macOS differ from it in font rasterisation and fail there
for reasons that are not regressions.

Runs against the production build with `VITE_USE_MOCK=true`, so it needs no
Python, no database and no key. The mock client answers from a fixed script,
which is what makes one run comparable to the last.

## What each file is for

- `accessibility.spec.ts` — axe against WCAG A and AA, plus two things axe does
  not cover: contrast computed from the *rendered* element, and whether meaning
  survives the loss of colour.
- `support.ts` — opening the console as a given tenant and mode, and an axe
  reporter that names the offending element rather than only its generated class.

## Two things worth knowing

**`reuseExistingServer` is on locally.** A preview server left running from an
earlier session serves the build it started with, so a source change appears to
have no effect. This cost real time; if a result looks impossible, kill whatever
holds port 4173 and run again. CI always builds fresh.

**Screenshots are platform-specific, and now strictly so.** Baselines are
generated in the same container CI uses — see the `appearance` job in
`.github/workflows/ci.yml`. The appearance suite therefore skips outside that
environment rather than failing every shot on macOS glyph rendering; run
`pnpm e2e:baselines` to exercise it. Accessibility and eviction run anywhere.

**The pixel budget is small on purpose.** It was `maxDiffPixelRatio: 0.01`,
which on a 1280x900 shot allows 11,520 changed pixels — enough to hide a
tenant's entire welcome screen changing. That was not hypothetical: three
starter questions and a placeholder were rewritten and every screenshot still
passed, because the glyphs that differed came to roughly 3,500 pixels. It is
now an absolute `maxDiffPixels: 250`.

**The build pins every flag the screenshots depend on.** Vite loads `.env.local`
for production builds as well as dev, so a developer's local file would
otherwise decide what a baseline contains: mine enabled the tenant switcher, and
CI — which has no such file — would have differed on every single screenshot.
`build:mock` sets `VITE_USE_MOCK`, `VITE_TENANT_SWITCHER` and `VITE_TENANT`
explicitly for that reason.

**The graph is masked, not skipped.** d3's force layout seeds from arrival order
and jiggles coincident nodes with `Math.random()`, so its pixels differ between
runs. Its structure is asserted in the unit suite by element count and identity,
and its colours by the contrast checks.
