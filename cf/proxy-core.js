const MEDIA_FILE_EXTENSIONS = [
  '.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.f4v', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
  '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma', '.alac', '.aiff', '.opus',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.avif', '.heic'
];

const MEDIA_CONTENT_TYPES = ['video/', 'audio/', 'image/'];

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

export function buildCorsHeaders(additionalHeaders = {}) {
  return new Headers({ ...BASE_CORS_HEADERS, ...additionalHeaders });
}

export function handleOptionsRequest() {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders({
      'Access-Control-Max-Age': '86400'
    })
  });
}

export async function handleProxyRequest(request, env, waitUntil = () => {}) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return handleOptionsRequest();
  }

  const unauthorizedResponse = new Response(
    JSON.stringify({
      success: false,
      error: '代理访问未授权：请检查密码配置或鉴权参数'
    }),
    {
      status: 401,
      headers: buildCorsHeaders({ 'Content-Type': 'application/json' })
    }
  );

  const authValid = await validateAuth(url, env);
  if (!authValid) {
    return unauthorizedResponse;
  }

  const DEBUG_ENABLED = env.DEBUG === 'true';
  const logDebug = (message) => {
    if (DEBUG_ENABLED) {
      console.log(`[Proxy Func] ${message}`);
    }
  };

  const CACHE_TTL = parseInt(env.CACHE_TTL || '86400', 10);
  const MAX_RECURSION = parseInt(env.MAX_RECURSION || '5', 10);

  let USER_AGENTS = [...DEFAULT_USER_AGENTS];
  try {
    const agentsJson = env.USER_AGENTS_JSON;
    if (agentsJson) {
      const parsedAgents = JSON.parse(agentsJson);
      if (Array.isArray(parsedAgents) && parsedAgents.length > 0) {
        USER_AGENTS = parsedAgents;
      } else {
        logDebug('环境变量 USER_AGENTS_JSON 格式无效或为空，使用默认值');
      }
    }
  } catch (error) {
    logDebug(`解析环境变量 USER_AGENTS_JSON 失败: ${error.message}，使用默认值`);
  }

  const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const createResponse = (body, status = 200, headers = new Headers()) => {
    const responseHeaders = headers instanceof Headers ? new Headers(headers) : new Headers(headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');
    return new Response(body, { status, headers: responseHeaders });
  };

  const createM3u8Response = (content) => createResponse(content, 200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Cache-Control': `public, max-age=${CACHE_TTL}`
  });

  const getBaseUrl = (urlStr) => {
    try {
      const parsedUrl = new URL(urlStr);
      if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
        return `${parsedUrl.origin}/`;
      }
      const pathParts = parsedUrl.pathname.split('/');
      pathParts.pop();
      return `${parsedUrl.origin}${pathParts.join('/')}/`;
    } catch (error) {
      logDebug(`获取 BaseUrl 时出错: ${urlStr} - ${error.message}`);
      const lastSlashIndex = urlStr.lastIndexOf('/');
      return lastSlashIndex > urlStr.indexOf('://') + 2
        ? urlStr.substring(0, lastSlashIndex + 1)
        : `${urlStr}/`;
    }
  };

  const resolveUrl = (baseUrl, relativeUrl) => {
    if (relativeUrl.match(/^https?:\/\//i)) {
      return relativeUrl;
    }
    try {
      return new URL(relativeUrl, baseUrl).toString();
    } catch (error) {
      logDebug(`解析 URL 失败: baseUrl=${baseUrl}, relativeUrl=${relativeUrl}, error=${error.message}`);
      if (relativeUrl.startsWith('/')) {
        try {
          const urlObj = new URL(baseUrl);
          return `${urlObj.origin}${relativeUrl}`;
        } catch {
          return relativeUrl;
        }
      }
      return `${baseUrl.replace(/\/[^/]*$/, '/')}${relativeUrl}`;
    }
  };

  const rewriteUrlToProxy = (targetUrl) => `/proxy/${encodeURIComponent(targetUrl)}`;

  const fetchContentWithType = async (targetUrl) => {
    const headers = new Headers({
      'User-Agent': getRandomUserAgent(),
      'Accept': '*/*',
      'Accept-Language': request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': request.headers.get('Referer') || new URL(targetUrl).origin
    });

    try {
      logDebug(`开始直接请求: ${targetUrl}`);
      const response = await fetch(targetUrl, { headers, redirect: 'follow' });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        logDebug(`请求失败: ${response.status} ${response.statusText} - ${targetUrl}`);
        throw new Error(`HTTP error ${response.status}: ${response.statusText}. URL: ${targetUrl}. Body: ${errorBody.substring(0, 150)}`);
      }

      const content = await response.text();
      const contentType = response.headers.get('Content-Type') || '';
      logDebug(`请求成功: ${targetUrl}, Content-Type: ${contentType}, 内容长度: ${content.length}`);
      return { content, contentType, responseHeaders: response.headers };
    } catch (error) {
      logDebug(`请求彻底失败: ${targetUrl}: ${error.message}`);
      throw new Error(`请求目标URL失败 ${targetUrl}: ${error.message}`);
    }
  };

  const isM3u8Content = (content, contentType) => {
    if (contentType && (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('audio/mpegurl')
    )) {
      return true;
    }
    return content && typeof content === 'string' && content.trim().startsWith('#EXTM3U');
  };

  const processKeyLine = (line, baseUrl) =>
    line.replace(/URI="([^"]+)"/, (match, uri) => {
      const absoluteUri = resolveUrl(baseUrl, uri);
      logDebug(`处理 KEY URI: 原始='${uri}', 绝对='${absoluteUri}'`);
      return `URI="${rewriteUrlToProxy(absoluteUri)}"`;
    });

  const processMapLine = (line, baseUrl) =>
    line.replace(/URI="([^"]+)"/, (match, uri) => {
      const absoluteUri = resolveUrl(baseUrl, uri);
      logDebug(`处理 MAP URI: 原始='${uri}', 绝对='${absoluteUri}'`);
      return `URI="${rewriteUrlToProxy(absoluteUri)}"`;
    });

  const processMediaPlaylist = (urlStr, content) => {
    const baseUrl = getBaseUrl(urlStr);
    const lines = content.split('\n');
    const output = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line && i === lines.length - 1) {
        output.push(line);
        continue;
      }
      if (!line) continue;

      if (line.startsWith('#EXT-X-KEY')) {
        output.push(processKeyLine(line, baseUrl));
        continue;
      }
      if (line.startsWith('#EXT-X-MAP')) {
        output.push(processMapLine(line, baseUrl));
        continue;
      }
      if (line.startsWith('#EXTINF')) {
        output.push(line);
        continue;
      }
      if (!line.startsWith('#')) {
        const absoluteUrl = resolveUrl(baseUrl, line);
        logDebug(`重写媒体片段: 原始='${line}', 绝对='${absoluteUrl}'`);
        output.push(rewriteUrlToProxy(absoluteUrl));
        continue;
      }
      output.push(line);
    }

    return output.join('\n');
  };

  const processM3u8Content = async (targetUrl, content, recursionDepth, envBindings) => {
    if (content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA:')) {
      logDebug(`检测到主播放列表: ${targetUrl}`);
      return processMasterPlaylist(targetUrl, content, recursionDepth, envBindings);
    }
    logDebug(`检测到媒体播放列表: ${targetUrl}`);
    return processMediaPlaylist(targetUrl, content);
  };

  const processMasterPlaylist = async (urlStr, content, recursionDepth, envBindings) => {
    if (recursionDepth > MAX_RECURSION) {
      throw new Error(`处理主列表时递归层数过多 (${MAX_RECURSION}): ${urlStr}`);
    }

    const baseUrl = getBaseUrl(urlStr);
    const lines = content.split('\n');
    let highestBandwidth = -1;
    let bestVariantUrl = '';

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
        const currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

        let variantUriLine = '';
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j].trim();
          if (line && !line.startsWith('#')) {
            variantUriLine = line;
            i = j;
            break;
          }
        }

        if (variantUriLine && currentBandwidth >= highestBandwidth) {
          highestBandwidth = currentBandwidth;
          bestVariantUrl = resolveUrl(baseUrl, variantUriLine);
        }
      }
    }

    if (!bestVariantUrl) {
      logDebug(`主列表中未找到 BANDWIDTH 或 STREAM-INF，尝试查找第一个子列表引用: ${urlStr}`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && (line.endsWith('.m3u8') || line.includes('.m3u8?'))) {
          bestVariantUrl = resolveUrl(baseUrl, line);
          logDebug(`备选方案：找到第一个子列表引用: ${bestVariantUrl}`);
          break;
        }
      }
    }

    if (!bestVariantUrl) {
      logDebug(`在主列表 ${urlStr} 中未找到任何有效的子播放列表 URL。将尝试按媒体列表处理原始内容。`);
      return processMediaPlaylist(urlStr, content);
    }

    const cacheKey = `m3u8_processed:${bestVariantUrl}`;
    let kvNamespace = null;
    try {
      kvNamespace = envBindings?.LIBRETV_PROXY_KV;
      if (!kvNamespace) throw new Error('KV 命名空间未绑定');
    } catch (error) {
      logDebug(`KV 命名空间 'LIBRETV_PROXY_KV' 访问出错或未绑定: ${error.message}`);
      kvNamespace = null;
    }

    if (kvNamespace) {
      try {
        const cachedContent = await kvNamespace.get(cacheKey);
        if (cachedContent) {
          logDebug(`[缓存命中] 主列表的子列表: ${bestVariantUrl}`);
          return cachedContent;
        }
        logDebug(`[缓存未命中] 主列表的子列表: ${bestVariantUrl}`);
      } catch (kvError) {
        logDebug(`从 KV 读取缓存失败 (${cacheKey}): ${kvError.message}`);
      }
    }

    logDebug(`选择的子列表 (带宽: ${highestBandwidth}): ${bestVariantUrl}`);
    const { content: variantContent, contentType: variantContentType } = await fetchContentWithType(bestVariantUrl);

    if (!isM3u8Content(variantContent, variantContentType)) {
      logDebug(`获取到的子列表 ${bestVariantUrl} 不是 M3U8 内容 (类型: ${variantContentType})。尝试按媒体列表处理。`);
      return processMediaPlaylist(bestVariantUrl, variantContent);
    }

    const processedVariant = await processM3u8Content(bestVariantUrl, variantContent, recursionDepth + 1, envBindings);

    if (kvNamespace) {
      try {
        waitUntil(kvNamespace.put(cacheKey, processedVariant, { expirationTtl: CACHE_TTL }));
        logDebug(`已将处理后的子列表写入缓存: ${bestVariantUrl}`);
      } catch (kvError) {
        logDebug(`向 KV 写入缓存失败 (${cacheKey}): ${kvError.message}`);
      }
    }

    return processedVariant;
  };

  try {
    const targetUrl = getTargetUrlFromPath(url.pathname, logDebug);

    if (!targetUrl) {
      logDebug(`无效的代理请求路径: ${url.pathname}`);
      return createResponse('无效的代理请求。路径应为 /proxy/<经过编码的URL>', 400);
    }

    logDebug(`收到代理请求: ${targetUrl}`);

    const cacheKey = `proxy_raw:${targetUrl}`;
    let kvNamespace = null;
    try {
      kvNamespace = env.LIBRETV_PROXY_KV;
      if (!kvNamespace) throw new Error('KV 命名空间未绑定');
    } catch (error) {
      logDebug(`KV 命名空间 'LIBRETV_PROXY_KV' 访问出错或未绑定: ${error.message}`);
      kvNamespace = null;
    }

    if (kvNamespace) {
      try {
        const cachedDataJson = await kvNamespace.get(cacheKey);
        if (cachedDataJson) {
          logDebug(`[缓存命中] 原始内容: ${targetUrl}`);
          const cachedData = JSON.parse(cachedDataJson);
          const content = cachedData.body;
          let headers = {};
          try {
            headers = JSON.parse(cachedData.headers);
          } catch (parseError) {
            logDebug(`解析缓存头信息失败 (${cacheKey}): ${parseError.message}`);
          }
          const contentType = headers['content-type'] || headers['Content-Type'] || '';

          if (isM3u8Content(content, contentType)) {
            logDebug(`缓存内容是 M3U8，重新处理: ${targetUrl}`);
            const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
            return createM3u8Response(processedM3u8);
          }

          logDebug(`从缓存返回非 M3U8 内容: ${targetUrl}`);
          return createResponse(content, 200, headers);
        }
        logDebug(`[缓存未命中] 原始内容: ${targetUrl}`);
      } catch (kvError) {
        logDebug(`从 KV 读取或解析缓存失败 (${cacheKey}): ${kvError.message}`);
      }
    }

    const { content, contentType, responseHeaders } = await fetchContentWithType(targetUrl);

    if (kvNamespace) {
      try {
        const headersToCache = {};
        responseHeaders.forEach((value, key) => { headersToCache[key.toLowerCase()] = value; });
        const cacheValue = { body: content, headers: JSON.stringify(headersToCache) };
        waitUntil(kvNamespace.put(cacheKey, JSON.stringify(cacheValue), { expirationTtl: CACHE_TTL }));
        logDebug(`已将原始内容写入缓存: ${targetUrl}`);
      } catch (kvError) {
        logDebug(`向 KV 写入缓存失败 (${cacheKey}): ${kvError.message}`);
      }
    }

    if (isM3u8Content(content, contentType)) {
      logDebug(`内容是 M3U8，开始处理: ${targetUrl}`);
      const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
      return createM3u8Response(processedM3u8);
    }

    logDebug(`内容不是 M3U8 (类型: ${contentType})，直接返回: ${targetUrl}`);
    const finalHeaders = new Headers(responseHeaders);
    finalHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
    finalHeaders.set('Access-Control-Allow-Origin', '*');
    finalHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    finalHeaders.set('Access-Control-Allow-Headers', '*');
    return createResponse(content, 200, finalHeaders);
  } catch (error) {
    logDebug(`处理代理请求时发生严重错误: ${error.message}\n${error.stack}`);
    return createResponse(`代理处理错误: ${error.message}`, 500);
  }
}

function getTargetUrlFromPath(pathname, logDebug) {
  const encodedUrl = pathname.replace(/^\/proxy\//, '');
  if (!encodedUrl) {
    return null;
  }

  try {
    let decodedUrl = decodeURIComponent(encodedUrl);
    if (!decodedUrl.match(/^https?:\/\//i)) {
      if (encodedUrl.match(/^https?:\/\//i)) {
        decodedUrl = encodedUrl;
        logDebug(`Warning: Path was not encoded but looks like URL: ${decodedUrl}`);
      } else {
        logDebug(`无效的目标URL格式 (解码后): ${decodedUrl}`);
        return null;
      }
    }
    return decodedUrl;
  } catch (error) {
    logDebug(`解码目标URL时出错: ${encodedUrl} - ${error.message}`);
    return null;
  }
}

async function validateAuth(url, env) {
  try {
    const authHash = url.searchParams.get('auth');
    const timestamp = url.searchParams.get('t');

    const serverPassword = env.PASSWORD;
    if (!serverPassword) {
      console.error('服务器未设置 PASSWORD 环境变量，代理访问被拒绝');
      return false;
    }

    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) {
      console.error('当前运行环境不支持 Web Crypto，无法验证密码');
      return false;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(serverPassword);
    const hashBuffer = await subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const serverPasswordHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    if (!authHash || authHash !== serverPasswordHash) {
      console.warn('代理请求鉴权失败：密码哈希不匹配');
      return false;
    }

    if (timestamp) {
      const now = Date.now();
      const maxAge = 10 * 60 * 1000;
      if (now - parseInt(timestamp, 10) > maxAge) {
        console.warn('代理请求鉴权失败：时间戳过期');
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('计算密码哈希失败:', error);
    return false;
  }
}
