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

describe('the endpoints that cost something are capped', () => {
  /**
   * Three endpoints spend something the caller does not pay for: a question
   * runs retrieval and then a model, an upload takes bytes, and a URL
   * attachment makes this service fetch on somebody else's behalf. Each is
   * capped separately because the sensible rate for one is wrong for another.
   */
  it.each([
    ['/api/query', 'asking'],
    ['/api/attachments', 'uploading'],
    ['/api/graph/query', 'querying'],
  ])('%s is limited by the %s zone', (path, zone) => {
    const block = nginx.match(
      new RegExp(`location = ${path.replace('/', '\\/')}\\s*\\{([\\s\\S]*?)\\n    \\}`),
    );

    expect(block, `no exact-match location for ${path}`).not.toBeNull();
    expect(block![1]).toContain(`limit_req zone=${zone}`);
  });

  it('declares every zone it uses', () => {
    const used = [...nginx.matchAll(/limit_req zone=(\w+)/g)].map((match) => match[1]);
    const declared = [...nginx.matchAll(/limit_req_zone[^;]*zone=(\w+):/g)].map((m) => m[1]);

    expect(used.length).toBeGreaterThan(0);
    for (const zone of used) expect(declared).toContain(zone);
  });

  it('answers a rate limit with 429 rather than 503', () => {
    // The caller asked too often; the service is not unavailable.
    expect(nginx).toContain('limit_req_status 429');
  });

  it('keeps the answer endpoint streaming', () => {
    // /api/query moved into its own location to be limited separately, and a
    // location that forgets proxy_buffering off delivers the whole answer at
    // the end — which looks like a hang rather than a regression.
    const block = nginx.match(/location = \/api\/query\s*\{([\s\S]*?)\n    \}/);

    expect(block![1]).toContain('proxy_buffering off');
    expect(block![1]).toContain('proxy_read_timeout 300s');
  });

  it('bounds an upload body before the service reads it', () => {
    const block = nginx.match(/location = \/api\/attachments\s*\{([\s\S]*?)\n    \}/);

    expect(block![1]).toMatch(/client_max_body_size \d+m/);
  });
});
