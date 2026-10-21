'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { analyze } = require('../src/analyzer');
const { bladeReferences, resolveBladeReference, controllerViewBases } = require('../src/blade');
const { resolveView } = require('../src/resolver');

async function main() {
  const [root, controller, blade, expected] = process.argv.slice(2);
  if (!expected) throw Error('Usage: node scripts/check-blade.js <root> <controller> <blade> <expected target>');
  const resolve = name => resolveView(name, {
    async isFile(file) { try { return (await fs.stat(path.join(root, file))).isFile(); } catch { return false; } },
    async directories(dir) { try { return (await fs.readdir(path.join(root, dir), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } }
  });
  const bases = await controllerViewBases(analyze(await fs.readFile(path.join(root, controller), 'utf8'), true), blade, resolve);
  assert.ok(bases.length, 'No controller matched the current Blade');
  const source = await fs.readFile(path.join(root, blade), 'utf8');
  for (const reference of bladeReferences(source)) {
    for (const base of bases) {
      const name = resolveBladeReference(reference, base);
      if (typeof name !== 'string') continue;
      const target = await resolve(name);
      if (target === expected) {
        assert.equal(source.slice(reference.start, reference.end), reference.expression);
        console.log(JSON.stringify({ expression: reference.expression, base, target }));
        return;
      }
    }
  }
  throw Error('Expected Blade link not found');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
