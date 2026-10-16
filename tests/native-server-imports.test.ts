import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('loads transpiled server entrypoints in native Node ESM and round-trips an intake panel round', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = mkdtempSync(join(root, 'Verification_2026-10-16', 'native-esm-'));
  try {
    // No bundler or TS loader: emitted import specifiers must work as deployed.
    const config = join(output, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({
      extends: join(root, 'tsconfig.json'),
      compilerOptions: { noEmit: false, allowImportingTsExtensions: false, rootDir: root, outDir: output },
      include: ['api', 'apps/api', 'packages'].map(directory => `${root.replaceAll('\\', '/')}/${directory}/**/*.ts`),
    }));
    const compiled = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', config], {
      cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    expect(compiled.status, `${compiled.stdout}${compiled.stderr}`).toBe(0);
    writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module' }));
    const entrypoints = readdirSync(join(root, 'api')).filter(name => name.endsWith('.ts'));
    writeFileSync(join(output, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      globalThis.fetch = () => { throw new Error('Network is forbidden in this smoke test'); };
      for (const file of ${JSON.stringify(entrypoints)}) {
        const module = await import('./api/' + file.replace(/\\.ts$/, '.js'));
        assert.equal(typeof module.default.fetch, 'function');
      }
      const domain = await import('./packages/domain/index.js');
      const created = domain.createPatient({ schemaVersion: 1, patients: [], branches: [], sessions: [], sources: [], versions: [], preferences: [] }, { name: 'Fictional native import test' });
      const next = domain.createSession(created.state, created.patient.id, created.branch.id, 4);
      const active = domain.startIntakeCompletion(next.state, next.session.id, 6, next.session.revision);
      assert.equal(domain.importState(domain.exportState(active)).sessions.find(s => s.id === next.session.id).intakeActive, true);
      const { handleWorkspace } = await import('./apps/api/workspace.js');
      const response = await handleWorkspace(new Request('https://fictional.test/api/workspace', { method: 'OPTIONS' }), { env: {} });
      assert.equal(response.status, 204);
      process.stdout.write('native-server-ok');
    `);
    expect(execFileSync(process.execPath, [join(output, 'smoke.mjs')], { cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true })).toBe('native-server-ok');
  } finally {
    const withinWorkspace = relative(root, output);
    if (withinWorkspace && !withinWorkspace.startsWith('..') && !isAbsolute(withinWorkspace)) rmSync(output, { recursive: true, force: true });
  }
}, 20000);
