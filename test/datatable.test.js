'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../src/analyzer');
const { dataTableViewBases } = require('../src/datatable');

const target = 'Modules\\Upm\\app\\DataTables\\Monev\\SurveyDataTable';
const table = `<?php namespace Modules\\Upm\\app\\DataTables\\Monev;
class SurveyDataTable extends DataTable {
  function dataTable($query) { return $query->addColumn('action', function($row) {
    return view($this->view.'.action', ['row' => $row]);
  }); }
}`;
function controller(type = 'SurveyDataTable', chain = '$table->with($this->getPageData())') {
  return `<?php namespace App;
  use ${target};
  class SurveyController { protected $view = 'upm::monev.daftar-survey';
    function index(${type} $table) { return ${chain}->render($this->view.'.index'); }
  }`;
}
test('unresolved DataTable reference retains class identity and clickable range', () => {
  assert.deepEqual(analyze(table), []);
  const [ref] = analyze(table, false, true);
  assert.equal(ref.className, target);
  assert.equal(table.slice(ref.start, ref.end), "$this->view.'.action'");
  const [base] = dataTableViewBases(controller(), ref.className);
  assert.equal(ref.viewTemplate.replace(ref.placeholder, base), 'upm::monev.daftar-survey.action');
});
test('fully qualified, imported alias and grouped imports resolve exact class', () => {
  assert.deepEqual(dataTableViewBases(controller('\\' + target), target), ['upm::monev.daftar-survey']);
  assert.deepEqual(dataTableViewBases(controller('Table').replace(`use ${target};`, `use ${target} as Table;`), target), ['upm::monev.daftar-survey']);
  assert.deepEqual(dataTableViewBases(controller().replace(`use ${target};`, 'use Modules\\Upm\\app\\DataTables\\Monev\\{SurveyDataTable, Other};'), target), ['upm::monev.daftar-survey']);
});
test('unrelated class, method receiver, or render without data does not infer view', () => {
  assert.deepEqual(dataTableViewBases(controller('OtherDataTable'), target), []);
  assert.deepEqual(dataTableViewBases(controller().replace(`use ${target};`, 'use Other\\SurveyDataTable;'), target), []);
  assert.deepEqual(dataTableViewBases(controller('SurveyDataTable', '$other->with($this->getPageData())'), target), []);
  assert.deepEqual(dataTableViewBases(controller('SurveyDataTable', '$table'), target), []);
});
test('pageData and explicit with view bindings', () => {
  for (const chain of ['$table->with($this->pageData)', "$table->with('view', $this->view)", "$table->with(['view' => $this->view])"]) {
    assert.deepEqual(dataTableViewBases(controller('SurveyDataTable', chain), target), ['upm::monev.daftar-survey']);
  }
});
test('declared or modified local view is not replaced by controller inference', () => {
  assert.deepEqual(analyze(table.replace('function dataTable', "protected $view; function dataTable"), false, true), []);
  assert.deepEqual(analyze(table.replace('return view(', "$this->view = dynamic(); return view("), false, true), []);
  const [ref] = analyze(table.replace('function dataTable', "protected $view = 'local'; function dataTable"), false, true);
  assert.equal(ref.name, 'local.action');
});
