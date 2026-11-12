# entra-tenant-resolver

Resolve Azure subscription GUIDs and Azure Key Vault URLs to Microsoft Entra tenant
GUIDs without Azure credentials or an Azure CLI installation. Requires Node.js 22+.

## Usage

Once published to npm:

```sh
npx entra-tenant-resolver 11111111-2222-3333-4444-555555555555 66666666-7777-8888-9999-000000000000
npx entra-tenant-resolver https://my-vault.vault.azure.net
npx entra-tenant-resolver 11111111-2222-3333-4444-555555555555 https://my-vault.vault.azure.net
```

Arguments are positional and can be mixed. Each successful lookup prints exactly:

```text
11111111-2222-3333-4444-555555555555 aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
https://my-vault.vault.azure.net aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
```

These are illustrative IDs, not real subscriptions or vaults. Input order is
preserved. Failures are written to stderr; other inputs are still processed.
The exit code is 1 if any lookup fails or no inputs are provided, otherwise 0.
Use `--help` for usage.

Add `--json` anywhere to output a single JSON array instead of plain text:

```sh
npx entra-tenant-resolver --json 11111111-2222-3333-4444-555555555555 https://my-vault.vault.azure.net
```

```json
[
  {
    "input": "11111111-2222-3333-4444-555555555555",
    "tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  },
  {
    "input": "https://my-vault.vault.azure.net",
    "tenantId": null,
    "error": "No tenant found (HTTP 400 or 404)."
  }
]
```

In JSON mode, lookup errors are included in the array rather than written to
stderr. Any failed lookup still sets exit code 1.

## How it works

Sends an unauthenticated GET to the subscription endpoint (ARM API `2016-06-01`)
or the vault's `/secrets?api-version=7.0` endpoint, then extracts the tenant GUID
from the HTTP 401 `WWW-Authenticate` Bearer authorization authority. No secrets
are read. HTTP 400/404 means no tenant was found; other statuses are errors.
Network access is required, and firewalls or private endpoints may prevent
discovery. Each request has a 15-second timeout; redirects are not followed.

Subscription GUIDs use public Azure (`management.azure.com`). Key Vault inputs
must be HTTPS base URLs, without credentials, custom ports, paths, query strings,
or fragments. Supported vault suffixes are `vault.azure.net`,
`vault.usgovcloudapi.net`, `vault.azure.cn`, and `vault.microsoftazure.de`.
Returned authorization authorities must belong to the vault's matching cloud.

## Library

```js
import { resolveTenant } from 'entra-tenant-resolver';

const tenantId = await resolveTenant('11111111-2222-3333-4444-555555555555');
// A tenant GUID, or null for HTTP 400/404. Other failures throw.
```

## Develop and publish

```sh
npm test
npm run check
node cli.js --help
npm pack
npm exec --package=. -- entra-tenant-resolver --help
npm publish
```

The package has no runtime dependencies. Publishing requires an npm account with
access to the package name; registry availability is not guaranteed. Until it is
published, run `node cli.js <input> [...]` from this directory, or run `npm link`
to install `entra-tenant-resolver` as a global command (`npm unlink -g
entra-tenant-resolver` removes it).

### Releasing

Publishing a GitHub release whose tag matches `package.json` (for example `v1.0.1`)
runs `.github/workflows/publish.yml`, which tests and publishes to npm using npm
trusted publishing (OIDC, no stored token) with provenance:

```sh
npm version patch        # bumps package.json and creates the matching tag
git push --follow-tags
gh release create v1.0.1 --generate-notes
```

One-time setup (also works when the local network blocks `registry.npmjs.org`,
because publishing happens on GitHub Actions):

1. On npmjs.com create a granular access token with read/write on packages, and
   save it as the `NPM_TOKEN` secret in the repo's `npm` environment:
   `gh secret set NPM_TOKEN --env npm -R gakama/entra-tenant-resolver`.
2. Create the first release (`gh release create v1.0.0 --generate-notes`).
3. On npmjs.com open the package's settings → Trusted Publisher → GitHub Actions
   and enter owner `gakama`, repository `entra-tenant-resolver`, workflow
   `publish.yml`, environment `npm`. Then delete the `NPM_TOKEN` secret and the
   token; later releases publish via OIDC.

The project `.npmrc` and `publishConfig` point npm at the public registry, so a
machine-wide corporate feed setting doesn't affect this package.
