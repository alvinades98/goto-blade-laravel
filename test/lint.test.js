'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dataTableIssues, yajraDeclaresView } = require('../src/lint');

const table = body => `<?php namespace M\\DataTables;
use Yajra\\DataTables\\Services\\DataTable;
class ItemDataTable extends DataTable {
  ${body}
  function dataTable($query) { return $query->addColumn('action', fn ($d) => view($this->view_path.'.action')); }
}`;
const kinds = (source, options) => dataTableIssues(source, options).map(issue => [issue.severity, source.slice(issue.start, issue.end)]);

test('detects vendor Yajra $view declaration, ignores commented-out patch', () => {
  assert.equal(yajraDeclaresView('class DataTable {\n    protected ?string $view = null;\n'), true);
  assert.equal(yajraDeclaresView('class DataTable {\n    // protected ?string $view = null;\n'), false);
  assert.equal(yajraDeclaresView(undefined), false);
});

test('boilerplate DataTable has no issues', () => {
  assert.deepEqual(kinds(table(''), { declaresView: true }), []);
});

test('$this->view is an error only when vendor declares it and the class does not', () => {
  const source = table("function x() { return view($this->view.'.score'); }");
  assert.deepEqual(kinds(source, { declaresView: true }), [['error', '$this->view']]);
  assert.deepEqual(kinds(source, { declaresView: false }), []);
  assert.deepEqual(kinds(source.replace('function x', "protected $view = 'a'; function x"), { declaresView: true }), []);
});

test('$tableId declaration and hardcoded cell view', () => {
  assert.deepEqual(kinds(table("protected string $tableId = 't';")), [['warning', "string $tableId = 't'"]]);
  assert.deepEqual(kinds(table("function x() { return view('ami::pages.a.action'); }")), [['info', "'ami::pages.a.action'"]]);
  assert.deepEqual(kinds(table("function x() { return [view('components.table-timestamp'), view('ami::components.x')]; }")), []);
});

test('controller DataTable entry point without with()', () => {
  const controller = body => `<?php namespace App;
  use M\\DataTables\\ItemDataTable;
  class C { function index(ItemDataTable $dataTable, Other $other) { ${body} } }`;
  assert.deepEqual(kinds(controller("return $dataTable->forScope(1)->render('x');")), [['warning', 'render']]);
  assert.deepEqual(kinds(controller('return $dataTable->ajax();')), [['warning', 'ajax']]);
  assert.deepEqual(kinds(controller("return $dataTable->forScope(1)->with($this->getPageData())->render('x');")), []);
  assert.deepEqual(kinds(controller("$dataTable->with($this->getPageData()); return $dataTable->render('x');")), []);
  assert.deepEqual(kinds(controller("return $other->render('x');")), []);
});
