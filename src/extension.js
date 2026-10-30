'use strict';

const vscode = require('vscode');
const path = require('node:path').posix;
const { analyze } = require('./analyzer');
const { resolveView } = require('./resolver');
const { bladeReferences, resolveBladeReference, controllerViewBases } = require('./blade');
const { dataTableViewBases } = require('./datatable');
const { standardIssues, yajraDeclaresView } = require('./lint');
// Keep in sync with laravelBladeNavigator.rules.* in package.json.
const LAYERS = ['controller', 'service', 'formRequest', 'model', 'dataTable', 'rawSql'];

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
              ? dataTableViewBases(source, reference.className, reference.property)
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

  const diagnostics = vscode.languages.createDiagnosticCollection('laravelBladeNavigator');
  const vendorView = new Map();
  const severity = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information };
  const enabled = uri => vscode.workspace.getConfiguration('laravelBladeNavigator', uri).get('dataTableDiagnostics', true);
  // Application code only: migrations/seeders, vendor and Blade follow other rules.
  const linted = uri => /\/(app|Modules)\//.test(uri.path) && !/\/(vendor|node_modules|database)\//.test(uri.path) && !uri.path.endsWith('.blade.php');
  function lint(document) {
    if (document.languageId !== 'php' || !linted(document.uri) || !enabled(document.uri)) return diagnostics.delete(document.uri);
    return lintText(document.uri, document.getText());
  }
  async function lintText(uri, text) {
    const root = await projectRoot({ uri }, { isCancellationRequested: false });
    if (root && !vendorView.has(root.toString())) {
      // ponytail: read once per session; reload the window after patching vendor.
      const vendor = vscode.Uri.joinPath(root, 'vendor/yajra/laravel-datatables-buttons/src/Services/DataTable.php');
      let source;
      try { source = Buffer.from(await vscode.workspace.fs.readFile(vendor)).toString('utf8'); } catch {}
      vendorView.set(root.toString(), yajraDeclaresView(source));
    }
    const declaresView = !!root && vendorView.get(root.toString());
    // Closed files have no TextDocument; compute positions from the text itself.
    const lineStarts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
    const positionAt = offset => {
      const line = lineStarts.findLastIndex(start => start <= offset);
      return new vscode.Position(line, offset - lineStarts[line]);
    };
    const rules = vscode.workspace.getConfiguration('laravelBladeNavigator.rules', uri);
    const issues = standardIssues(text, { declaresView, rules: Object.fromEntries(LAYERS.map(layer => [layer, rules.get(layer, true)])) });
    diagnostics.set(uri, issues.map(issue => {
      const diagnostic = new vscode.Diagnostic(new vscode.Range(positionAt(issue.start), positionAt(issue.end)), issue.message, severity[issue.severity]);
      diagnostic.source = 'Laravel Standar';
      return diagnostic;
    }));
    return issues.length;
  }
  // Results of a workspace scan stay in the Problems panel after their file is closed.
  const scanned = new Set();
  const viewId = 'laravelBladeNavigator.dataTables';
  context.subscriptions.push(vscode.commands.registerCommand('laravelBladeNavigator.scanDataTables', () =>
    vscode.window.withProgress({ location: { viewId }, title: 'Scan standar' }, async () => {
      const files = await vscode.workspace.findFiles('**/{app,Modules}/**/*.php', '**/{vendor,node_modules,database}/**');
      for (const uri of files) {
        if (!linted(uri) || !enabled(uri)) { diagnostics.delete(uri); continue; }
        const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        let text;
        try { text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { continue; }
        if (await lintText(uri, text)) scanned.add(uri.toString());
      }
      await vscode.commands.executeCommand(viewId + '.focus');
    })));

  // Sidebar: files that break the boilerplate standard, each expanding to its findings.
  const rank = { [vscode.DiagnosticSeverity.Error]: 0, [vscode.DiagnosticSeverity.Warning]: 1, [vscode.DiagnosticSeverity.Information]: 2 };
  const icon = { 0: ['error', 'problemsErrorIcon.foreground'], 1: ['warning', 'problemsWarningIcon.foreground'], 2: ['info', 'problemsInfoIcon.foreground'] };
  const changed = new vscode.EventEmitter();
  let treeMode = context.workspaceState.get('treeMode', false);
  const setTreeMode = value => {
    treeMode = value;
    context.workspaceState.update('treeMode', value);
    vscode.commands.executeCommand('setContext', 'laravelBladeNavigator.treeMode', value);
    changed.fire();
  };
  setTreeMode(treeMode);
  context.subscriptions.push(
    vscode.commands.registerCommand('laravelBladeNavigator.viewAsTree', () => setTreeMode(true)),
    vscode.commands.registerCommand('laravelBladeNavigator.viewAsList', () => setTreeMode(false)));
  // Tree mode: group files under their folders, like the Explorer.
  function folderTree(files) {
    const root = { children: new Map(), files: [] };
    for (const file of files) {
      const workspace = vscode.workspace.getWorkspaceFolder(file.uri);
      let base = workspace?.uri ?? file.uri.with({ path: '/' });
      let node = root;
      for (const segment of path.relative(base.path, path.dirname(file.uri.path)).split('/').filter(Boolean)) {
        base = vscode.Uri.joinPath(base, segment);
        if (!node.children.has(segment)) node.children.set(segment, { folder: base, children: new Map(), files: [], count: 0 });
        node = node.children.get(segment);
        node.count += file.count;
      }
      node.files.push(file);
    }
    return root;
  }
  const childrenOf = node => [
    ...[...node.children.values()].sort((a, b) => a.folder.path.localeCompare(b.folder.path)),
    ...node.files.sort((a, b) => a.uri.path.localeCompare(b.uri.path))
  ];
  const tree = {
    onDidChangeTreeData: changed.event,
    getChildren(node) {
      if (node?.folder) return childrenOf(node);
      if (node) return diagnostics.get(node.uri).map(diagnostic => ({ uri: node.uri, diagnostic }));
      const files = [];
      diagnostics.forEach((uri, list) => list.length && files.push({ uri, count: list.length, worst: Math.min(...list.map(d => rank[d.severity])) }));
      if (treeMode) return childrenOf(folderTree(files));
      return files.sort((a, b) => a.worst - b.worst || a.uri.path.localeCompare(b.uri.path));
    },
    getTreeItem(node) {
      if (node.folder) {
        const item = new vscode.TreeItem(node.folder, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.description = String(node.count);
        return item;
      }
      if (!node.diagnostic) {
        const item = new vscode.TreeItem(node.uri, treeMode ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        item.description = treeMode ? String(node.count) : `${vscode.workspace.asRelativePath(path.dirname(node.uri.path))} · ${node.count}`;
        return item;
      }
      const { diagnostic } = node;
      const [id, color] = icon[rank[diagnostic.severity]];
      const item = new vscode.TreeItem(diagnostic.message);
      item.description = `baris ${diagnostic.range.start.line + 1}`;
      item.tooltip = diagnostic.message;
      item.iconPath = new vscode.ThemeIcon(id, new vscode.ThemeColor(color));
      item.command = { command: 'vscode.open', title: 'Buka', arguments: [node.uri, { selection: diagnostic.range }] };
      return item;
    }
  };
  const view = vscode.window.createTreeView(viewId, { treeDataProvider: tree, showCollapseAll: true });
  let autoScanned = false;
  context.subscriptions.push(view, changed,
    vscode.languages.onDidChangeDiagnostics(() => {
      changed.fire();
      let total = 0;
      diagnostics.forEach((uri, list) => { total += list.length; });
      view.badge = total ? { value: total, tooltip: `${total} temuan standar` } : undefined;
    }),
    // ponytail: first look at the sidebar scans once; afterwards edits update it live, Scan refreshes the rest.
    view.onDidChangeVisibility(event => {
      if (event.visible && !autoScanned) { autoScanned = true; vscode.commands.executeCommand('laravelBladeNavigator.scanDataTables'); }
    }));
  vscode.workspace.textDocuments.forEach(lint);
  context.subscriptions.push(diagnostics,
    vscode.workspace.onDidOpenTextDocument(lint),
    vscode.workspace.onDidChangeTextDocument(event => lint(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => scanned.has(document.uri.toString()) || diagnostics.delete(document.uri)),
    vscode.commands.registerCommand('laravelBladeNavigator.openRuleSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'laravelBladeNavigator.rules')),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('laravelBladeNavigator.dataTableDiagnostics') && !event.affectsConfiguration('laravelBladeNavigator.rules')) return;
      vscode.workspace.textDocuments.forEach(lint);
      // Closed files only refresh through a scan.
      if (scanned.size) vscode.commands.executeCommand('laravelBladeNavigator.scanDataTables');
    }));
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
