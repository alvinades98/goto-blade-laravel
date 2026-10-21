'use strict';

const Engine = require('php-parser');
const parser = new Engine({ parser: { suppressErrors: true }, ast: { withPositions: true } });

function children(node) {
  return Object.entries(node).filter(([key]) => key !== 'loc')
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value === 'object' && value.kind);
}

function propertyName(node) {
  return node?.kind === 'propertylookup' && node.what?.kind === 'variable'
    && node.what.name === 'this' && node.offset?.kind === 'identifier'
    ? node.offset.name : undefined;
}

function evaluate(node, properties, seen = new Set(), variables = {}) {
  if (!node) return undefined;
  if (node.kind === 'string') return node.value;
  if (node.kind === 'variable') return Object.hasOwn(variables, node.name) ? variables[node.name] : undefined;
  if (node.kind === 'bin' && node.type === '.') {
    const left = evaluate(node.left, properties, seen, variables);
    const right = evaluate(node.right, properties, seen, variables);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  const name = propertyName(node);
  if (!name || seen.has(name)) return undefined;
  return evaluate(properties.get(name), properties, new Set([...seen, name]));
}

function classProperties(node) {
  const properties = new Map();
  for (const statement of node.body || []) {
    if (statement.kind !== 'propertystatement' || statement.isStatic) continue;
    for (const property of statement.properties) properties.set(property.name.name, property.value);
  }
  // A modified property cannot safely be resolved from its declaration alone.
  function invalidate(current) {
    if (current !== node && current.kind === 'class') return;
    if (['assign', 'assignref', 'pre', 'post'].includes(current.kind)) {
      properties.delete(propertyName(current.left || current.what));
    }
    for (const child of children(current)) invalidate(child);
  }
  invalidate(node);
  return properties;
}

function isViewCall(node) {
  if (node.kind !== 'call') return false;
  const what = node.what;
  if (what.kind === 'name') return what.name.replace(/^\\/, '').toLowerCase() === 'view';
  if (what.kind === 'propertylookup') return ['view', 'render'].includes(what.offset?.name?.toLowerCase());
  if (what.kind === 'staticlookup') {
    return /(^|\\)View$/i.test(what.what?.name || '') && ['make', 'first'].includes(what.offset?.name?.toLowerCase());
  }
  return false;
}

/** Resolve only static strings: never execute PHP or load the Laravel app. */
function analyze(source, includeContext = false, includeUnresolved = false) {
  let ast;
  try { ast = parser.parseCode(source); } catch { return []; }
  const references = [];
  function visit(node, properties, namespace = '', className, canInject = false) {
    if (node.kind === 'namespace') namespace = node.name || '';
    if (node.kind === 'class') {
      properties = classProperties(node);
      className = [namespace, node.name?.name].filter(Boolean).join('\\');
      canInject = !node.isAnonymous;
      function check(current) {
        if (current !== node && current.kind === 'class') return;
        if (current.kind === 'property' && current.name?.name === 'view') canInject = false;
        if (['assign', 'assignref', 'pre', 'post'].includes(current.kind) && propertyName(current.left || current.what) === 'view') canInject = false;
        children(current).forEach(check);
      }
      check(node);
    }
    if (isViewCall(node)) {
      const argument = node.arguments?.[0];
      const expression = argument?.kind === 'namedargument' ? argument.value : argument;
      const value = evaluate(expression, properties);
      if (typeof value === 'string' && expression.loc) {
        const reference = { name: value, start: expression.loc.start.offset, end: expression.loc.end.offset };
        if (includeContext) reference.viewBase = evaluate(properties.get('view'), properties);
        references.push(reference);
      } else if (includeUnresolved && canInject && expression?.loc) {
        const placeholder = '__BLADE_EXTERNAL_VIEW__';
        const value = evaluate(expression, new Map([...properties, ['view', { kind: 'string', value: placeholder }]]));
        if (typeof value === 'string' && value.includes(placeholder)) {
          references.push({ start: expression.loc.start.offset, end: expression.loc.end.offset,
            className, viewTemplate: value, placeholder });
        }
      }
    }
    for (const child of children(node)) visit(child, properties, namespace, className, canInject);
  }
  visit(ast, new Map());
  return references;
}

function evaluateExpression(source, variables = {}) {
  try {
    const ast = parser.parseCode('<?php ' + source + ';');
    if (ast.errors.length || ast.children.length !== 1) return undefined;
    return evaluate(ast.children[0].expression, new Map(), new Set(), variables);
  } catch { return undefined; }
}

module.exports = { analyze, evaluateExpression, children, classProperties, evaluate };
