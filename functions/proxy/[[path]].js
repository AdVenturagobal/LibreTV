import { handleProxyRequest, handleOptionsRequest } from '../../cf/proxy-core.js';

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  return handleProxyRequest(request, env, waitUntil);
}

export const onOptions = handleOptionsRequest;
