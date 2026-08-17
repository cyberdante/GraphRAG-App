# Browser checks

The suite that runs in a browser, because the one that does not cannot see.

Four defects reached a person before they reached a test: a settings drawer
opening behind the app bar, near-black button text at 4.19:1, a read-only chip
styled as a control, and shipped-versus-blocking encoded in red against green.
Every one passed the unit suite and always would have — jsdom does no layout and
has no opinion about perception.

```bash
pnpm e2e            # run
pnpm e2e:update     # accept new screenshots
```

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

**Screenshots are platform-specific.** Font rasterisation differs between macOS
and Linux, so baselines are generated in the same container CI uses rather than
on a developer's machine. See the `visual` job in `.github/workflows/ci.yml`.
