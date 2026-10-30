'use strict';

const Engine = require('php-parser');
const { children } = require('./analyzer');
const parser = new Engine({ parser: { suppressErrors: true }, ast: { withPositions: true } });

/** True when vendor Yajra still declares `$view`, shadowing the with() value. */
function yajraDeclaresView(source) {
  return /^\s*(?:public|protected|private)\s+(?:\??\w+\s+)?\$view\b/m.test(source || '');
}

function thisProperty(node) {
  return node?.kind === 'propertylookup' && node.what?.kind === 'variable' && node.what.name === 'this'
    ? node.offset?.name : undefined;
}

const shortName = type => type?.kind === 'name' ? type.name.split('\\').at(-1) : '';

/** Static checks for the getPageData → with() → $this->view_path DataTable convention. */
function dataTableIssues(source, { declaresView = false } = {}) {
  let ast;
  try { ast = parser.parseCode(source); } catch { return []; }
  const issues = [];
  const add = (node, severity, message) => node?.loc && issues.push({ start: node.loc.start.offset, end: node.loc.end.offset, severity, message });
  function walk(node, fn) {
    fn(node);
    for (const child of children(node)) if (child.kind !== 'class') walk(child, fn);
  }
  function chain(call) {
    const names = [];
    let receiver = call;
    while (receiver?.kind === 'call' && receiver.what?.kind === 'propertylookup') {
      names.push(receiver.what.offset?.name);
      receiver = receiver.what.what;
    }
    return { names, root: receiver?.kind === 'variable' ? receiver.name : undefined };
  }
  function visitClass(node) {
    const statements = node.body || [];
    const declared = new Set(statements.filter(s => s.kind === 'propertystatement').flatMap(s => s.properties.map(p => p.name.name)));
    if (/DataTable$/.test(shortName(node.extends))) {
      for (const statement of statements.filter(s => s.kind === 'propertystatement')) {
        for (const property of statement.properties.filter(p => p.name.name === 'tableId')) {
          add(property, 'warning', 'DataTable tidak boleh mendeklarasikan $tableId; nilainya datang dari controller lewat ->with($this->getPageData()).');
        }
      }
      walk(node, current => {
        if (declaresView && !declared.has('view') && thisProperty(current) === 'view') {
          add(current, 'error', '$this->view selalu null di Yajra DataTable (vendor mendeklarasikan protected ?string $view). Gunakan $this->view_path.');
        }
        if (current.kind === 'call' && current.what?.kind === 'name' && current.what.name.replace(/^\\/, '').toLowerCase() === 'view'
          // Only module page views duplicate the controller's $view; shared partials like components.* are fine.
          && current.arguments?.[0]?.kind === 'string' && /::(?!components\.)/.test(current.arguments[0].value)) {
          add(current.arguments[0], 'info', 'View cell di-hardcode. Gunakan $this->view_path.\'.<partial>\' atau beri komentar alasan partial berada di luar $view controller.');
        }
      });
    }
    for (const method of statements.filter(s => s.kind === 'method' && s.body)) {
      const tables = new Set((method.arguments || []).filter(arg => /DataTable$/.test(shortName(arg.type))).map(arg => arg.name.name));
      if (!tables.size) continue;
      const calls = [];
      walk(method.body, current => { if (current.kind === 'call') calls.push([current, chain(current)]); });
      // ponytail: any with() on the parameter anywhere in the method counts, so split statements don't false-warn.
      const passed = new Set(calls.filter(([, c]) => c.names.includes('with')).map(([, c]) => c.root));
      for (const [call, c] of calls) {
        if (tables.has(c.root) && !passed.has(c.root) && ['render', 'ajax', 'html'].includes(c.names[0])) {
          add(call.what.offset, 'warning', `$${c.root}->${c.names[0]}() tanpa ->with($this->getPageData()); $this->view_path, $this->route dan $this->tableId akan kosong di DataTable.`);
        }
      }
    }
  }
  (function visit(node) {
    if (node.kind === 'class') visitClass(node);
    children(node).forEach(visit);
  })(ast);
  return issues;
}

module.exports = { dataTableIssues, yajraDeclaresView };
