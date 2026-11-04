// The PreToolUse hook must compare paths in one Unicode form (NFC/NFD) so Korean folder names
// neither lock out in-scope edits nor depend on which form the caller sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(workspace, '.claude', 'hooks', 'guard-scope.mjs');
const forms = { NFC: s => s.normalize('NFC'), NFD: s => s.normalize('NFD') };

const run = (tool, file_path, cwd = workspace) =>
  spawnSync('node', [hook], { input: JSON.stringify({ tool_name: tool, tool_input: { file_path }, cwd }), encoding: 'utf8' }).status;

test('this checkout has non-ASCII path characters, so the NFC/NFD cases mean something', () => {
  assert.notEqual(workspace.normalize('NFC'), workspace.normalize('NFD'));
});

for (const [name, to] of Object.entries(forms)) {
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    test(`${tool}: in-scope file allowed (${name} path)`, () => {
      assert.equal(run(tool, to(path.join(workspace, 'memory', 'keys.mjs'))), 0);
    });
  }
  test(`in-scope file allowed when cwd and path use different forms (${name} path)`, () => {
    const other = name === 'NFC' ? forms.NFD : forms.NFC;
    assert.equal(run('Write', to(path.join(workspace, 'docs', 'x.md')), other(workspace)), 0);
  });
  test(`relative in-scope path allowed (${name} cwd)`, () => {
    assert.equal(run('Write', 'docs/x.md', to(workspace)), 0);
  });
  for (const outside of [
    ['baseline core', path.resolve(workspace, '..', '..', 'src', 'index.mjs')],
    ['sibling agent folder', path.resolve(workspace, '..', 'a-other', 'index.mjs')],
    ['sibling with same prefix', `${workspace}-copy/x.mjs`],
    ['relative escape', path.join(workspace, '..', '..', 'src', 'index.mjs')],
    ['repo root', path.resolve(workspace, '..', '..', '..', 'README.md')],
  ]) {
    test(`out-of-scope blocked: ${outside[0]} (${name} path)`, () => {
      assert.equal(run('Edit', to(outside[1])), 2);
    });
  }
  test(`out-of-scope blocked when cwd is outside (${name} cwd, relative path)`, () => {
    assert.equal(run('Write', 'index.mjs', to(path.resolve(workspace, '..', '..', 'src'))), 2);
  });
}
