'use strict';

const vscode = require('vscode');
const path = require('node:path').posix;
const { analyze } = require('./analyzer');
const { resolveView } = require('./resolver');
const { bladeReferences, resolveBladeReference, controllerViewBases } = require('./blade');
const { dataTableViewBases } = require('./datatable');

async function isFile(uri) {
  try { return !!((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File); }
  catch { return false; }
}

async function projectRoot(document, token) {
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspace) return undefined;
  let directory = document.uri.with({ path: path.dirname(document.uri.path) });
  while (!token.isCancellationRequested) {
    if (await isFile(vscode.Uri.joinPath(directory, 'artisan'))) return directory;
    if (directory.path === workspace.uri.path) return directory;
    const parent = path.dirname(directory.path);
    if (parent === directory.path) return undefined;
    directory = directory.with({ path: parent });
  }
}

function activate(context) {
  const cache = new Map();
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => cache.delete(document.uri.toString())));
  const selector = [
    { language: 'php' }, { language: 'blade' }, { pattern: '**/*.blade.php' }
  ];
  const provider = {
    async provideDefinition(document, position, token) {
      const key = document.uri.toString();
      const isBlade = document.uri.path.endsWith('.blade.php');
      let entry = cache.get(key);
      if (!entry || entry.version !== document.version) {
        entry = { version: document.version, references: isBlade ? bladeReferences(document.getText()) : analyze(document.getText(), false, /\/DataTables\//i.test(document.uri.path)) };
        cache.set(key, entry);
      }
      const offset = document.offsetAt(position);
      const reference = entry.references.find(item => item.start <= offset && offset < item.end);
      if (!reference || token.isCancellationRequested) return undefined;
      const root = await projectRoot(document, token);
      if (!root || token.isCancellationRequested) return undefined;
      const namespaces = vscode.workspace.getConfiguration('laravelBladeNavigator', document.uri).get('namespaces', {});
      const io = {
        isFile: relative => isFile(vscode.Uri.joinPath(root, relative)),
        async directories(relative) {
          try {
            return (await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, relative)))
              .filter(([, type]) => type & vscode.FileType.Directory).map(([name]) => name);
          } catch { return []; }
        }
      };
      const resolved = new Map();
      const resolve = name => {
        if (!resolved.has(name)) resolved.set(name, resolveView(name, io, namespaces));
        return resolved.get(name);
      };
      let names = reference.name ? [reference.name] : [];
      if (isBlade) {
        const literal = resolveBladeReference(reference);
        names = typeof literal === 'string' ? [literal] : [];
      }
      if ((isBlade && !names.length && /\$view\b/.test(reference.expression)) || reference.viewTemplate) {
        const relativePath = path.relative(root.path, document.uri.path);
        const bases = new Set();
        const module = /^Modules\/([^/]+)\//.exec(relativePath)?.[1];
        const scopes = module
          ? [vscode.Uri.joinPath(root, 'Modules', module), root]
          : [root];
        const visited = new Set();
        for (const scope of scopes) {
          const pattern = scope === root ? '{app,Modules}/**/*Controller.php' : '**/*Controller.php';
          const files = await vscode.workspace.findFiles(new vscode.RelativePattern(scope, pattern), '**/{vendor,node_modules}/**', undefined, token);
          // Read current editor contents when a controller has unsaved changes.
          for (const uri of files) {
            if (token.isCancellationRequested) return undefined;
            if (visited.has(uri.toString())) continue;
            visited.add(uri.toString());
            let source;
            try {
              const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
              source = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            } catch { continue; }
            const found = reference.viewTemplate
              ? dataTableViewBases(source, reference.className)
              : await controllerViewBases(analyze(source, true), relativePath, resolve);
            for (const base of found) bases.add(base);
          }
          if (bases.size) break;
        }
        names = [...bases].map(base => reference.viewTemplate
          ? reference.viewTemplate.split(reference.placeholder).join(base)
          : resolveBladeReference(reference, base)).filter(name => typeof name === 'string');
      }
      const targets = [...new Set((await Promise.all(names.map(resolve))).filter(Boolean))];
      if (!targets.length || token.isCancellationRequested) return undefined;
      const beginning = new vscode.Range(0, 0, 0, 0);
      return targets.map(target => ({
        originSelectionRange: new vscode.Range(document.positionAt(reference.start), document.positionAt(reference.end)),
        targetUri: vscode.Uri.joinPath(root, target),
        targetRange: beginning,
        targetSelectionRange: beginning
      }));
    }
  };
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, provider));
  // A document link also supports Ctrl+click when a Blade extension owns the
  // language's definition behavior. Resolve lazily, only on hover/click.
  const origins = new WeakMap();
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ pattern: '**/*.blade.php' }, {
    provideDocumentLinks(document) {
      return bladeReferences(document.getText()).map(reference => {
        const link = new vscode.DocumentLink(new vscode.Range(document.positionAt(reference.start), document.positionAt(reference.end)));
        link.tooltip = 'Buka view Blade';
        origins.set(link, { document, version: document.version });
        return link;
      });
    },
    async resolveDocumentLink(link, token) {
      const origin = origins.get(link);
      if (!origin || origin.document.version !== origin.version) return undefined;
      const definitions = await provider.provideDefinition(origin.document, link.range.start, token);
      if (definitions?.length !== 1) return undefined;
      link.target = definitions[0].targetUri;
      return link;
    }
  }));
}

module.exports = { activate };
