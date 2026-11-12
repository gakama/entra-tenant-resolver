import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTenant } from '../index.js';

const subscription = '11111111-2222-3333-4444-555555555555';
const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function challenge(authority, parameter = 'authorization_uri') {
  return new Response(null, {
    status: 401,
    headers: { 'www-authenticate': `Bearer ${parameter}="${authority}", resource="https://management.azure.com/"` },
  });
}

test('discovers a subscription tenant with an unauthenticated, bounded request', async () => {
  const result = await resolveTenant(subscription, {
    fetch: async (url, options) => {
      assert.equal(url, `https://management.azure.com/subscriptions/${subscription}?api-version=2016-06-01`);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers, undefined);
      return challenge(`https://login.windows.net/${tenant}`);
    },
  });
  assert.equal(result, tenant);
});

test('discovers Key Vault tenants in each supported cloud', async () => {
  for (const [suffix, authority] of [
    ['azure.net', 'login.windows.net'],
    ['usgovcloudapi.net', 'login.microsoftonline.us'],
    ['azure.cn', 'login.chinacloudapi.cn'],
    ['microsoftazure.de', 'login.microsoftonline.de'],
  ]) {
    const vault = `https://my-vault.vault.${suffix}`;
    assert.equal(await resolveTenant(vault, {
      fetch: async (url) => {
        assert.equal(url, `${vault}/secrets?api-version=7.0`);
        return challenge(`https://${authority}/${tenant}/`, 'authorization');
      },
    }), tenant);
  }
});

test('rejects invalid subscriptions and untrusted vault URLs before fetching', async () => {
  for (const input of [
    'not-a-guid', '11111111-2222-3333-4444-55555555555z',
    'http://my-vault.vault.azure.net', 'https://localhost',
    'https://my-vault.vault.azure.net.evil.example',
    'https://user:pass@my-vault.vault.azure.net',
    'https://my-vault.vault.azure.net:8443',
    'https://my-vault.vault.azure.net/secrets',
    'https://my-vault.vault.azure.net?foo=bar',
    'https://my-vault.vault.azure.net#fragment',
    'https://nested.my-vault.vault.azure.net',
    'https://my--vault.vault.azure.net',
  ]) {
    let fetched = false;
    await assert.rejects(resolveTenant(input, {
      fetch: async () => { fetched = true; },
    }), /Expected/);
    assert.equal(fetched, false, input);
  }
});

test('returns null for not-found and bad-request responses', async () => {
  for (const status of [400, 404]) {
    assert.equal(await resolveTenant(subscription, {
      fetch: async () => new Response(null, { status }),
    }), null);
  }
});

test('rejects unexpected statuses without following redirects', async () => {
  for (const status of [200, 302, 403, 429, 500]) {
    await assert.rejects(resolveTenant(subscription, {
      fetch: async () => new Response(null, { status }),
    }), new RegExp(`Unexpected HTTP ${status}`));
  }
});

test('rejects missing, malformed, cross-cloud, and untrusted authorization authorities', async () => {
  for (const authority of [
    `http://login.windows.net/${tenant}`,
    `https://login.windows.net.evil.example/${tenant}`,
    `https://login.microsoftonline.us/${tenant}`,
    `https://user:pass@login.windows.net/${tenant}`,
    `https://login.windows.net:8443/${tenant}`,
    `https://login.windows.net/${tenant}?foo=bar`,
    `https://login.windows.net/${tenant}#fragment`,
    `https://login.windows.net/extra/${tenant}`,
    'https://login.windows.net/common', 'not-a-url',
  ]) {
    await assert.rejects(resolveTenant(subscription, {
      fetch: async () => challenge(authority),
    }), /authority|tenant GUID/);
  }
  for (const header of ['', 'Basic realm="example"', 'Bearer resource="example"']) {
    await assert.rejects(resolveTenant(subscription, {
      fetch: async () => new Response(null, {
        status: 401, headers: { 'www-authenticate': header },
      }),
    }), /Bearer authorization authority/);
  }
});

test('accepts case-insensitive Bearer parameters after other parameters', async () => {
  assert.equal(await resolveTenant(subscription, {
    fetch: async () => new Response(null, {
      status: 401,
      headers: {
        'www-authenticate': `Basic realm="example", bEaReR resource="example", AUTHORIZATION_URI=https://login.microsoftonline.com/${tenant}`,
      },
    }),
  }), tenant);
});

test('cancels the response body and propagates network failures', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  assert.equal(await resolveTenant(subscription, {
    fetch: async () => new Response(body, {
      status: 401,
      headers: { 'www-authenticate': `Bearer authorization_uri="https://login.windows.net/${tenant}"` },
    }),
  }), tenant);
  assert.equal(cancelled, true);
  await assert.rejects(resolveTenant(subscription, {
    fetch: async () => { throw new Error('Network unavailable'); },
  }), /Network unavailable/);
});
