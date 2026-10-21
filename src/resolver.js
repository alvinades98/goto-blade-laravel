'use strict';

/** Paths are relative to one Laravel root, and never escape it. */
function viewParts(name) {
  const parts = name.split('::');
  if (parts.length > 2) return undefined;
  const namespace = parts.length === 2 ? parts[0] : undefined;
  const view = parts.at(-1);
  if (namespace !== undefined && !/^[\w-]+$/.test(namespace)) return undefined;
  if (!view || !/^[\w./-]+$/.test(view) || view.split(/[./]/).some(part => !part)) return undefined;
  return { namespace, file: view.replaceAll('.', '/') + '.blade.php' };
}

function safeDirectory(directory) {
  return typeof directory === 'string' && directory.length > 0
    && !directory.startsWith('/') && !directory.includes('\\')
    && !directory.includes(':') && !directory.split('/').includes('..');
}

async function resolveView(name, io, namespaces = {}) {
  const parts = viewParts(name);
  if (!parts) return undefined;
  const { namespace, file } = parts;
  let directories;
  if (!namespace) directories = ['resources/views'];
  else if (Object.hasOwn(namespaces, namespace)) {
    directories = Array.isArray(namespaces[namespace]) ? namespaces[namespace].filter(safeDirectory) : [];
  } else {
    directories = [`resources/views/vendor/${namespace}`, `resources/views/modules/${namespace}`];
    const modules = await io.directories('Modules');
    for (const module of modules.filter(name => name.toLowerCase() === namespace.toLowerCase())) {
      directories.push(`Modules/${module}/resources/views`, `Modules/${module}/Resources/views`);
    }
  }
  for (const directory of directories) {
    const candidate = `${directory}/${file}`;
    if (await io.isFile(candidate)) return candidate;
  }
  return undefined;
}

module.exports = { resolveView, viewParts };
