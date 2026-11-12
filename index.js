const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const vaultClouds = [
  { suffix: '.vault.azure.net', authorities: ['login.microsoftonline.com', 'login.windows.net'] },
  { suffix: '.vault.usgovcloudapi.net', authorities: ['login.microsoftonline.us'] },
  { suffix: '.vault.azure.cn', authorities: ['login.chinacloudapi.cn', 'login.partner.microsoftonline.cn'] },
  { suffix: '.vault.microsoftazure.de', authorities: ['login.microsoftonline.de'] },
];

function discoveryTarget(input) {
  if (guid.test(input)) {
    return {
      url: `https://management.azure.com/subscriptions/${input}?api-version=2016-06-01`,
      authorities: ['login.microsoftonline.com', 'login.windows.net'],
    };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Expected a subscription GUID or an HTTPS Azure Key Vault base URL.');
  }

  const cloud = vaultClouds.find(({ suffix }) => url.hostname.endsWith(suffix));
  const name = cloud && url.hostname.slice(0, -cloud.suffix.length);
  if (
    url.protocol !== 'https:' || url.username || url.password || url.port ||
    url.pathname !== '/' || url.search || url.hash ||
    !name || !/^[a-z][a-z0-9-]{1,22}[a-z0-9]$/i.test(name) || name.includes('--')
  ) {
    throw new Error('Expected a supported HTTPS Azure Key Vault base URL.');
  }

  url.pathname = '/secrets';
  url.search = 'api-version=7.0';
  return { url: url.href, authorities: cloud.authorities };
}

function tenantFromChallenge(header, authorities) {
  const bearer = header?.match(/(?:^|,)\s*Bearer\s+/i);
  const parameters = bearer && header.slice(bearer.index + bearer[0].length);
  const authority = parameters?.match(
    /(?:^|,)\s*(?:authorization_uri|authorization)\s*=\s*(?:"([^"]+)"|([^,\s]+))/i,
  );
  if (!authority) {
    throw new Error('The response did not contain a Bearer authorization authority.');
  }

  let url;
  try {
    url = new URL(authority[1] ?? authority[2]);
  } catch {
    throw new Error('The response contained an invalid authorization authority.');
  }

  const tenantId = url.pathname.replace(/^\/|\/$/g, '');
  if (
    url.protocol !== 'https:' || !authorities.includes(url.hostname) ||
    url.username || url.password || url.port || url.search || url.hash || !guid.test(tenantId)
  ) {
    throw new Error('The response contained an untrusted authorization authority or invalid tenant GUID.');
  }
  return tenantId;
}

export async function resolveTenant(input, { fetch: fetchRequest = globalThis.fetch } = {}) {
  const target = discoveryTarget(input);
  const response = await fetchRequest(target.url, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

  try {
    if (response.status === 400 || response.status === 404) {
      return null;
    }
    if (response.status !== 401) {
      throw new Error(`Unexpected HTTP ${response.status} from the discovery endpoint.`);
    }
    return tenantFromChallenge(response.headers.get('www-authenticate'), target.authorities);
  } finally {
    await response.body?.cancel();
  }
}
