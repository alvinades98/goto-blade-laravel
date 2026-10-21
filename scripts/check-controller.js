'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { analyze } = require('../src/analyzer');
const { resolveView } = require('../src/resolver');

async function main() {
  const [root, controller] = process.argv.slice(2);
  if (!root || !controller) throw new Error('Usage: node scripts/check-controller.js <Laravel root> <controller path relative to root>');
  const source = await fs.readFile(path.resolve(root, controller), 'utf8');
  const references = analyze(source);
  if (!references.length) throw new Error('No static view references found');
  for (const reference of references) {
    const target = await resolveView(reference.name, {
      async isFile(file) {
        try { return (await fs.stat(path.join(root, file))).isFile(); } catch { return false; }
      },
      async directories(directory) {
        try { return (await fs.readdir(path.join(root, directory), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); }
        catch { return []; }
      }
    });
    console.log(JSON.stringify({ expression: source.slice(reference.start, reference.end), view: reference.name, target: target || null }));
    if (!target) process.exitCode = 1;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
