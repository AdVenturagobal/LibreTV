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

async function sha256(message) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error('crypto.subtle 不可用，无法计算密码哈希');
  }
  const data = new TextEncoder().encode(message);
  const hashBuffer = await subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
