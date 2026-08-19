import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The headers are only set where they are included, and nginx will not say so.
 *
 * `add_header` does not merge downwards: a `location` that sets any header of
 * its own discards every one inherited from the server block. Setting the
 * security headers once at the top looked right, served them on nothing that
 * had its own Cache-Control, and would have shipped a policy covering only the
 * paths nobody had configured. The config was valid and the server started.
 *
 * So this reads the config rather than trusting it, because the failure is
 * silent and the next person to add a `location` will not know.
 */
const CONFIG_DIR = join(__dirname, '..', '..');
const nginx = readFileSync(join(CONFIG_DIR, 'nginx.conf'), 'utf8');
const headers = readFileSync(join(CONFIG_DIR, 'security-headers.conf'), 'utf8');

describe('security headers reach every path', () => {
  const locations = [...nginx.matchAll(/location\s+([^\s{]+)\s*\{([\s\S]*?)\n    \}/g)];

  it('finds the locations it is meant to be checking', () => {
    // If the pattern stops matching, the assertions below pass vacuously.
    expect(locations.length).toBeGreaterThanOrEqual(4);
  });

  it.each(locations.map((match) => [match[1]!, match[2]!]))(
    'location %s includes them',
    (_path, body) => {
      expect(body).toContain('include /etc/nginx/security-headers.conf;');
    },
  );
});

describe('what the policy actually says', () => {
  it('allows no script source beyond this origin', () => {
    // The build makes this possible: index.html carries no inline script.
    expect(headers).toMatch(/script-src 'self'[;"]/);
    expect(headers).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(headers).not.toContain("'unsafe-eval'");
  });

  it('allows inline styles, which is a stated gap rather than an oversight', () => {
    // Emotion injects component styles at runtime and a static file server
    // cannot mint a per-response nonce.
    expect(headers).toContain("style-src 'self' 'unsafe-inline'");
    expect(headers).toMatch(/emotion injects/i);
  });

  it('keeps connections to this origin', () => {
    // The one place the product reaches another origin is a URL attachment,
    // fetched by the service under its own guard rather than by the browser.
    expect(headers).toContain("connect-src 'self'");
  });

  it('refuses framing and plugins outright', () => {
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("object-src 'none'");
  });

  it('stops the browser guessing a content type', () => {
    // Guessing is how a text upload becomes a script.
    expect(headers).toContain('X-Content-Type-Options');
    expect(headers).toContain('nosniff');
  });

  it('sets every header unconditionally', () => {
    // Without `always`, nginx omits them on error responses — which are exactly
    // the responses an attacker is trying to produce.
    const directives = headers.match(/^add_header .*/gm) ?? [];
    expect(directives.length).toBeGreaterThan(0);
    for (const directive of directives) expect(directive.trimEnd()).toMatch(/always;$/);
  });
});
