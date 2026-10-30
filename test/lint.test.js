'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { standardIssues: dataTableIssues, yajraDeclaresView } = require('../src/lint');

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

const ctrl = (body, extra = '') => `<?php namespace M\\Http\\Controllers;
use App\\Http\\Controllers\\Controller;
use Illuminate\\Http\\Request;
use M\\Models\\Program;
use M\\Http\\Requests\\ProgramRequest;
class ProgramController extends Controller {
  public function __construct(private ProgramService $service) { parent::__construct(); }
  ${extra}
  public function store(ProgramRequest $request, Program $program, Request $plain) { ${body} }
}`;

test('boilerplate controller has no issues', () => {
  assert.deepEqual(kinds(ctrl("$data = $this->service->create($request->validated()); return $this->responseService->success($data, 'ok');")), []);
});

test('controller: validation, input, permission, response and Eloquent are flagged', () => {
  const cases = {
    "$request->validate(['a' => 'required']);": ['warning', 'validate'],
    '$plain->input("a");': ['warning', 'input'],
    '$request->all();': ['warning', 'all'],
    'request()->get("a");': ['warning', 'get'],
    "Validator::make([], []);": ['warning', 'Validator::make'],
    "$this->validate($plain, []);": ['warning', '$this->validate'],
    "$this->authorize('x');": ['warning', '$this->authorize'],
    "return response()->json([]);": ['warning', 'json'],
    "Program::where('a', 1)->get();": ['warning', 'Program::where'],
    '$program->update([]);': ['warning', 'update'],
    "DB::transaction(fn () => 1);": ['warning', 'DB::transaction'],
  };
  for (const [body, expected] of Object.entries(cases)) assert.deepEqual(kinds(ctrl(body)), [expected], body);
  assert.deepEqual(kinds(ctrl('if ($request->x) { return 1; }')), [['info', 'if']]);
  assert.deepEqual(kinds(ctrl("return view('masterdata::pages.menu-settings.index', []);")), [['warning', "'masterdata::pages.menu-settings.index'"]]);
  assert.deepEqual(kinds(ctrl("return View::make('ns::pages.a.'.$x);")), [['warning', "'ns::pages.a.'"]]);
  assert.deepEqual(kinds(ctrl("return view($this->view.'.index', $this->getData());")), []);
  const own = ctrl("return view('ns::pages.persons.partials.table');", "protected string $view = 'ns::pages.persons';");
  assert.match(dataTableIssues(own)[0].message, /\$this->view\.'\.partials\.table'/);
});

test('reference controller patterns are allowed; chains are reported once', () => {
  assert.deepEqual(kinds(ctrl("$program->loadMissing('period:id'); $program->setRelation('a', 1); return request()->boolean('only_trashed');")), []);
  assert.deepEqual(kinds(ctrl("return $program->items()->where('a', 1)->first();")), [['warning', 'first']]);
  assert.deepEqual(kinds(ctrl('', 'public function tabCounts(): JsonResponse { return response()->json($this->service->counts()); }')), []);
});

test('a disabled layer drops only its own findings', () => {
  const source = ctrl("DB::table('x'); $request->validate([]);");
  assert.deepEqual(dataTableIssues(source).map(i => i.layer), ['rawSql', 'controller']);
  assert.deepEqual(dataTableIssues(source, { rules: { controller: false } }).map(i => i.layer), ['rawSql']);
  assert.deepEqual(dataTableIssues(source, { rules: { rawSql: false, controller: false } }), []);
});

test('controller constructor without parent::__construct() is an error', () => {
  const source = ctrl('return 1;').replace(' parent::__construct(); ', ' ');
  assert.deepEqual(kinds(source), [['error', '__construct']]);
});

test('service, form request, model and raw SQL', () => {
  const service = body => `<?php namespace Modules\\M\\Services;
  class ProgramService extends BaseService { public function run(): array { ${body} } }`;
  assert.deepEqual(kinds(service("return DB::transaction(fn () => []);")), []);
  assert.deepEqual(kinds(service("return request()->all();")), [['warning', 'request']]);
  assert.deepEqual(kinds(service("return DB::table('x')->get();")), [['warning', 'DB::table']]);
  assert.deepEqual(kinds(service("return Program::query()->whereRaw('1')->get();")), [['warning', 'whereRaw']]);
  assert.deepEqual(kinds(service("return Program::query()->draw();")), []);
  assert.deepEqual(kinds('<?php namespace Modules\\M\\Services; class ProgramService { function a(): JsonResponse { return 1; } }'),
    [['info', 'ProgramService'], ['warning', 'JsonResponse']]);
  assert.deepEqual(kinds('<?php namespace App\\Services; class ResponseApiService { function a(): JsonResponse { return response()->json(); } }'), []);
  assert.deepEqual(kinds('<?php namespace App\\Models; use Illuminate\\Database\\Eloquent\\Model; class BaseModel extends Model {}'), []);
  assert.deepEqual(kinds("<?php class SpmiTableMigration { function a() { DB::statement('x'); } }"), []);
  assert.deepEqual(kinds('<?php class R extends FormRequest { function authorize(): bool { return true; } }'), []);
  assert.deepEqual(kinds('<?php class R extends FormRequest { function authorize(): bool { return false; } }'), [['info', 'authorize']]);
  assert.deepEqual(kinds('<?php use Illuminate\\Database\\Eloquent\\Model; class P extends Model {}'), [['warning', 'Model']]);
  assert.deepEqual(kinds('<?php class P extends BaseModel { protected $schema = SCHEMA_X; }'), []);
  assert.deepEqual(kinds('<?php class P extends BaseModel {}'), [['warning', 'P']]);
});
