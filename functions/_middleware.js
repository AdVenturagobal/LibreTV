import { sha256 } from '../public/js/sha256.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    let html = await response.text();
    
    // 处理普通密码
    const password = env.PASSWORD || "";
    let passwordHash = "";
    if (password) {
      passwordHash = await sha256(password);
    }
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";', 
      `window.__ENV__.PASSWORD = "${passwordHash}";`);
    
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  
  return response;
}
