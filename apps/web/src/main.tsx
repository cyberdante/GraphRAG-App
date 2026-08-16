import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { acme, loadTenant, reportResolution } from './theme';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

const root = createRoot(container);

/**
 * The tenant is resolved before the first render rather than after.
 *
 * Rendering with a placeholder brand and swapping when the document lands
 * would show every user a flash of somebody else's product. The fetch is
 * bounded by a timeout and falls back to the bundled tenant, so waiting costs
 * at most that timeout and a slow branding host cannot hold the app hostage.
 *
 * Written as an async bootstrap rather than top-level await: the latter is not
 * available at the browser baseline this builds for, and raising the target for
 * one call would be a strange trade.
 */
async function bootstrap(): Promise<void> {
  const resolution = await loadTenant().catch(() => null);

  if (resolution) {
    reportResolution(resolution);
  } else {
    console.warn('Tenant resolution failed outright; rendering the bundled default.');
  }

  root.render(
    <StrictMode>
      <App tenant={resolution?.tenant ?? acme} />
    </StrictMode>,
  );
}

void bootstrap();
