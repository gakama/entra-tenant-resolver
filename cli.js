#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTenant } from './index.js';

const usage = `Usage: npx entra-tenant-resolver [--json] <subscription-guid|key-vault-url> [...]

Prints one "input tenantId" line per successful lookup. No Azure login required.
Inputs may mix subscription GUIDs and HTTPS Key Vault base URLs.
Use --json to print an array of results, including errors, as JSON.
`;

export async function run(args, {
  resolve = resolveTenant,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const json = args.includes('--json');
  const inputs = args.filter((arg) => arg !== '--json');
  if (inputs.length === 1 && (inputs[0] === '--help' || inputs[0] === '-h')) {
    stdout.write(usage);
    return 0;
  }
  if (inputs.length === 0) {
    stderr.write(usage);
    return 1;
  }

  let exitCode = 0;
  const results = [];
  for (const input of inputs) {
    try {
      const tenantId = await resolve(input);
      if (!tenantId) {
        throw new Error('No tenant found (HTTP 400 or 404).');
      }
      if (json) {
        results.push({ input, tenantId });
      } else {
        stdout.write(`${input} ${tenantId}\n`);
      }
    } catch (error) {
      if (json) {
        results.push({ input, tenantId: null, error: error.message });
      } else {
        stderr.write(`${input}: ${error.message}\n`);
      }
      exitCode = 1;
    }
  }
  if (json) {
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  }
  return exitCode;
}

function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMain()) {
  process.exitCode = await run(process.argv.slice(2));
}
