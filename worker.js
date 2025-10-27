import { handleProxyRequest, handleOptionsRequest } from './cf/proxy-core.js';
import { sha256 } from './public/js/sha256.js';

const PASSWORD_PLACEHOLDER = 'window.__ENV__.PASSWORD = "{{PASSWORD}}";';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const waitUntil = ctx && typeof ctx.waitUntil === 'function'
      ? (promise) => ctx.waitUntil(promise)
      : () => {};

    if (url.pathname.startsWith('/proxy/')) {
      return handleProxyRequest(request, env, waitUntil);
    }

    if (request.method === 'OPTIONS') {
      return handleOptionsRequest();
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (!assetResponse) {
      return new Response('Not Found', { status: 404 });
    }

    const contentType = assetResponse.headers.get('Content-Type') || '';

    if (contentType.includes('text/html')) {
      const html = await assetResponse.text();
      const updatedHtml = await injectPasswordIntoHtml(html, env);
      const headers = new Headers(assetResponse.headers);
      headers.delete('Content-Length');
      return new Response(updatedHtml, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return assetResponse;
  }
};

async function injectPasswordIntoHtml(html, env) {
  if (!html.includes(PASSWORD_PLACEHOLDER)) {
    return html;
  }

  const password = env.PASSWORD || '';
  let replacement = 'window.__ENV__.PASSWORD = "";';

  if (password) {
    const hash = await sha256(password);
    replacement = `window.__ENV__.PASSWORD = "${hash}";`;
  }

  return html.replace(PASSWORD_PLACEHOLDER, replacement);
}
