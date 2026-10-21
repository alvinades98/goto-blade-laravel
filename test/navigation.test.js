'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../src/analyzer');
const { resolveView } = require('../src/resolver');

const controller = `<?php
class TugasAkhirBimbinganController extends Controller {
    protected $view = 'mahasiswa::pages.tugas-akhir';
    public function index() {
        return $dataTable->render($this->view.'.bimbingan', $pageData);
    }
}`;

test('controller property concatenation resolves entire clickable expression', () => {
  const [reference] = analyze(controller);
  assert.equal(reference.name, 'mahasiswa::pages.tugas-akhir.bimbingan');
  assert.equal(controller.slice(reference.start, reference.end), "$this->view.'.bimbingan'");
});

test('static helper, facade and multiline concatenation', () => {
  const refs = analyze(`<?php
    view('home');
    \\view('pages.' .\n ('index'));
    View::make('dashboard');
    \\Illuminate\\Support\\Facades\\View::make('account');
    response()->view('welcome');
  `);
  assert.deepEqual(refs.map(ref => ref.name), ['home', 'pages.index', 'dashboard', 'account', 'welcome']);
});

test('properties stay scoped to their class', () => {
  const refs = analyze(`<?php
    class A { protected $view='a'; function index() { return view($this->view.'.index'); } }
    class B { protected $view='b'; function index() { return view($this->view.'.index'); } }
  `);
  assert.deepEqual(refs.map(ref => ref.name), ['a.index', 'b.index']);
});

test('comments, unrelated strings, interpolated and dynamic expressions are ignored', () => {
  assert.deepEqual(analyze(`<?php
    // view('fake');
    /* view('fake'); */
    $x = "view('fake')";
    view($unknown.'.index');
    view("pages.$dynamic");
    view(getView());
  `), []);
});

test('modified property does not link to a stale default', () => {
  assert.deepEqual(analyze(`<?php class A {
    protected $view='old';
    function index() { $this->view = getView(); return view($this->view.'.index'); }
  }`), []);
});

test('invalid PHP does not throw', () => {
  assert.doesNotThrow(() => analyze('<?php class { broken !!!'));
});

function io(files, modules = ['Mahasiswa']) {
  return { isFile: async name => files.includes(name), directories: async () => modules };
}

test('realistic controller expression resolves to module blade', async () => {
  const target = 'Modules/Mahasiswa/resources/views/pages/tugas-akhir/bimbingan.blade.php';
  assert.equal(await resolveView(analyze(controller)[0].name, io([target])), target);
});

test('legacy uppercase Resources and published overrides', async () => {
  const legacy = 'Modules/Mahasiswa/Resources/views/index.blade.php';
  const override = 'resources/views/modules/mahasiswa/index.blade.php';
  assert.equal(await resolveView('mahasiswa::index', io([legacy])), legacy);
  assert.equal(await resolveView('mahasiswa::index', io([legacy, override])), override);
});

test('standard views and configured namespaces', async () => {
  assert.equal(await resolveView('pages.index', io(['resources/views/pages/index.blade.php'])), 'resources/views/pages/index.blade.php');
  assert.equal(await resolveView('custom::index', io(['features/views/index.blade.php']), { custom: ['features/views'] }), 'features/views/index.blade.php');
});

test('missing and unsafe paths never return targets', async () => {
  assert.equal(await resolveView('missing', io([])), undefined);
  for (const name of ['../secret', 'module::../secret', '/etc/passwd', 'a::b::c', 'a..b']) {
    assert.equal(await resolveView(name, { isFile: async () => true }), undefined);
  }
  assert.equal(await resolveView('custom::index', io([]), { custom: ['../outside'] }), undefined);
});
