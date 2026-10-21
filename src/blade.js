'use strict';

const { evaluateExpression } = require('./analyzer');
const { viewParts } = require('./resolver');

// Preserve UTF-16 offsets so the link covers the expression in the editor.
function bladeReferences(source) {
  const masked = source.replace(/\{\{--[\s\S]*?--\}\}|@verbatim\b[\s\S]*?@endverbatim\b|@php\b(?!\s*\()[\s\S]*?@endphp\b/g,
    text => text.replace(/[^\r\n]/g, ' '));
  const references = [];
  const directives = /(?<!@)@(include|includeIf|includeOnce|extends|component)\s*\(/g;
  let match;
  while ((match = directives.exec(masked))) {
    const start = directives.lastIndex;
    let depth = 0;
    let quote;
    let end = start;
    for (; end < masked.length; end++) {
      const char = masked[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (masked.startsWith('/*', end)) {
        const close = masked.indexOf('*/', end + 2);
        if (close < 0) { end = masked.length; break; }
        end = close + 1;
        continue;
      }
      if (masked.startsWith('//', end) || char === '#') {
        const close = masked.indexOf('\n', end);
        if (close < 0) { end = masked.length; break; }
        end = close;
        continue;
      }
      if (depth === 0 && (char === ',' || char === ')')) break;
      if ('([{'.includes(char)) depth++;
      if (')]}'.includes(char)) depth--;
      if (depth < 0) break;
    }
    if (end === masked.length || depth !== 0 || quote) continue;
    const expression = source.slice(start, end);
    const leading = expression.length - expression.trimStart().length;
    const trimmed = expression.trim();
    if (trimmed) references.push({ expression: trimmed, start: start + leading, end: start + leading + trimmed.length });
    directives.lastIndex = end + 1;
  }
  return references;
}

function resolveBladeReference(reference, viewBase) {
  return evaluateExpression(reference.expression, typeof viewBase === 'string' ? { view: viewBase } : {});
}

/** Match a controller's rendered view, not just a similarly named folder. */
async function controllerViewBases(references, documentPath, resolve) {
  const bases = new Set();
  for (const reference of references) {
    if (typeof reference.viewBase !== 'string') continue;
    const parts = viewParts(reference.name);
    if (!parts || !documentPath.endsWith('/' + parts.file)) continue;
    if (await resolve(reference.name) === documentPath) bases.add(reference.viewBase);
  }
  return [...bases];
}

module.exports = { bladeReferences, resolveBladeReference, controllerViewBases };
