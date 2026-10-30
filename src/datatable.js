'use strict';

const Engine = require('php-parser');
const { children, classProperties, evaluate } = require('./analyzer');
const parser = new Engine({ parser: { suppressErrors: true } });

/** Follow typed method parameters and their with(...)->render(...) chain.
 * getPageData/pageData follows the application's shared controller convention.
 * No PHP execution, folder-name guesses, or short-class-name matching.
 */
function dataTableViewBases(source, targetClass, property = 'view') {
  let ast;
  try { ast = parser.parseCode(source); } catch { return []; }
  const bases = new Set();
  function scope(nodes, namespace = '') {
    const imports = new Map();
    for (const node of nodes) {
      if (node.kind !== 'usegroup' || node.type) continue;
      for (const item of node.items) {
        if (item.type) continue;
        const full = [node.name, item.name].filter(Boolean).join('\\');
        imports.set((item.alias?.name || full.split('\\').at(-1)).toLowerCase(), full);
      }
    }
    function qualified(type) {
      if (type?.kind !== 'name') return undefined;
      const name = type.name;
      if (name.startsWith('\\')) return name.slice(1);
      if (name.startsWith('namespace\\')) return [namespace, name.slice(10)].filter(Boolean).join('\\');
      const [first, ...rest] = name.split('\\');
      return [imports.get(first.toLowerCase()) || [namespace, first].filter(Boolean).join('\\'), ...rest].join('\\');
    }
    for (const node of nodes) {
      if (node.kind === 'namespace') { scope(node.children, node.name); continue; }
      if (node.kind !== 'class') continue;
      const properties = classProperties(node);
      const base = evaluate(properties.get('view'), properties);
      function hasPageData(expression, seen = new Set()) {
        if (expression?.kind === 'bin' && expression.type === '+') return hasPageData(expression.left, seen);
        if (expression?.kind !== 'call' || expression.arguments.length || expression.what?.kind !== 'propertylookup' || expression.what.what?.name !== 'this') return false;
        const name = expression.what.offset?.name;
        if (name === 'getPageData') return true;
        if (seen.has(name)) return false;
        const method = node.body.find(item => item.kind === 'method' && item.name?.name === name && !item.arguments?.length);
        const statements = method?.body?.children;
        return statements?.length === 1 && statements[0].kind === 'return'
          && hasPageData(statements[0].expr, new Set([...seen, name]));
      }
      for (const method of node.body.filter(item => item.kind === 'method')) {
        const parameters = new Set((method.arguments || []).filter(arg => qualified(arg.type)?.toLowerCase() === targetClass.toLowerCase()).map(arg => arg.name.name));
        if (!parameters.size) continue;
        function visit(current) {
          if (current.kind === 'class' || current.kind === 'function') return;
          if (current.kind === 'call' && current.what?.kind === 'propertylookup' && current.what.offset?.name === 'render') {
            let receiver = current.what.what;
            let passed;
            while (receiver?.kind === 'call' && receiver.what?.kind === 'propertylookup') {
              if (receiver.what.offset?.name === 'with') {
                const args = receiver.arguments;
                const first = args[0];
                let value;
                if (first?.kind === 'string' && first.value === property) value = evaluate(args[1], properties);
                else if (first?.kind === 'array') {
                  const entry = first.items.find(item => item.key?.value === property);
                  value = evaluate(entry?.value, properties);
                } else if (first?.kind === 'propertylookup' && first.what?.name === 'this' && first.offset?.name === 'pageData') value = base;
                else if (hasPageData(first)) value = base;
                // Outer with() wins when the same chain sets view repeatedly.
                if (passed === undefined && typeof value === 'string') passed = value;
              }
              receiver = receiver.what.what;
            }
            if (receiver?.kind === 'variable' && parameters.has(receiver.name) && typeof passed === 'string') bases.add(passed);
          }
          children(current).forEach(visit);
        }
        if (method.body) visit(method.body);
      }
    }
  }
  scope(ast.children);
  return [...bases];
}

module.exports = { dataTableViewBases };
