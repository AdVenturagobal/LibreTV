// Vercel Middleware to inject environment variables
export default async function middleware(request) {
  // Get the URL from the request
  const url = new URL(request.url);
  
  // Only process HTML pages
  const isHtmlPage = url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (!isHtmlPage) {
    return; // Let the request pass through unchanged
  }

  // Fetch the original response
  const response = await fetch(request);
  
  // Check if it's an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response; // Return the original response if not HTML
  }

  // Get the HTML content
  const originalHtml = await response.text();
  
  // Replace the placeholder with actual environment variable
  // If PASSWORD is not set, replace with empty string
  const password = process.env.PASSWORD || '';
  let passwordHash = '';
  if (password) {
    passwordHash = await sha256(password);
  }
  
  // 替换密码占位符
  let modifiedHtml = originalHtml.replace(
    'window.__ENV__.PASSWORD = "{{PASSWORD}}";',
    `window.__ENV__.PASSWORD = "${passwordHash}"; // SHA-256 hash`
  );

  // 修复Response构造
  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(modifiedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export const config = {
  matcher: ['/', '/((?!api|_next/static|_vercel|favicon.ico).*)'],
};

async function sha256(message) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    // fallback for local dev where middleware may run in Node
    const { createHash } = await import('crypto');
    return createHash('sha256').update(message).digest('hex');
  }
  const data = new TextEncoder().encode(message);
  const hashBuffer = await subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
