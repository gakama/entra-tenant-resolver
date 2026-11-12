import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from '../cli.js';

function capture(resolve) {
  const output = { stdout: '', stderr: '' };
  return {
    output,
    options: {
      resolve,
      stdout: { write(text) { output.stdout += text; } },
      stderr: { write(text) { output.stderr += text; } },
    },
  };
}

test('prints mixed positional inputs in order, one input/tenant pair per line', async () => {
  const inputs = [
    '11111111-2222-3333-4444-555555555555',
    'https://my-vault.vault.azure.net',
    '66666666-7777-8888-9999-000000000000',
  ];
  const { output, options } = capture(async (input) => `tenant${inputs.indexOf(input) + 1}`);
  assert.equal(await run(inputs, options), 0);
  assert.equal(output.stdout, inputs.map((input, i) => `${input} tenant${i + 1}\n`).join(''));
  assert.equal(output.stderr, '');
});

test('continues after errors and missing tenants, reporting failures only on stderr', async () => {
  const { output, options } = capture(async (input) => {
    if (input === 'bad') throw new Error('Invalid input');
    return input === 'missing' ? null : 'tenant';
  });
  assert.equal(await run(['bad', 'missing', 'good'], options), 1);
  assert.equal(output.stdout, 'good tenant\n');
  assert.match(output.stderr, /bad: Invalid input\nmissing: No tenant found/);
});

test('shows help and reports missing inputs without making requests', async () => {
  for (const args of [[], ['--help'], ['-h'], ['--json'], ['--json', '--help']]) {
    const { output, options } = capture(async () => assert.fail('Unexpected lookup'));
    const help = args.includes('--help') || args.includes('-h');
    assert.equal(await run(args, options), help ? 0 : 1);
    assert.match(help ? output.stdout : output.stderr, /Usage: npx entra-tenant-resolver/);
    assert.equal(help ? output.stderr : output.stdout, '');
  }
});

test('prints one JSON array with successful inputs in order and accepts the flag anywhere', async () => {
  for (const args of [['--json', 'sub', 'vault'], ['sub', '--json', 'vault'], ['sub', 'vault', '--json']]) {
    const { output, options } = capture(async (input) => `${input}-tenant`);
    assert.equal(await run(args, options), 0);
    assert.deepEqual(JSON.parse(output.stdout), [
      { input: 'sub', tenantId: 'sub-tenant' },
      { input: 'vault', tenantId: 'vault-tenant' },
    ]);
    assert.equal(output.stderr, '');
  }
});

test('includes failures in JSON while continuing lookups and setting a nonzero exit code', async () => {
  const { output, options } = capture(async (input) => {
    if (input === 'bad') throw new Error('Invalid input');
    return input === 'missing' ? null : 'tenant';
  });
  assert.equal(await run(['--json', 'bad', 'missing', 'good'], options), 1);
  assert.deepEqual(JSON.parse(output.stdout), [
    { input: 'bad', tenantId: null, error: 'Invalid input' },
    { input: 'missing', tenantId: null, error: 'No tenant found (HTTP 400 or 404).' },
    { input: 'good', tenantId: 'tenant' },
  ]);
  assert.equal(output.stderr, '');
});
