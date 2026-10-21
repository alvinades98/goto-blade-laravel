'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../src/analyzer');
const { bladeReferences, resolveBladeReference, controllerViewBases } = require('../src/blade');
const { resolveView } = require('../src/resolver');

test('Blade include expression and range exclude data argument', () => {
  const source = "😀 @include($view.'.partials.status', ['status' => $status])";
  const [ref] = bladeReferences(source);
  assert.equal(source.slice(ref.start, ref.end), "$view.'.partials.status'");
  assert.equal(resolveBladeReference(ref, 'tugasakhir::pages.data.pendaftar'), 'tugasakhir::pages.data.pendaftar.partials.status');
  assert.equal(resolveBladeReference(ref), undefined);
});

test('literal directives, multiline concatenation and parentheses', () => {
  const refs = bladeReferences(`@extends('layouts.app')
    @includeIf( ($view .\n '.partials.status'), ['x' => fn() => 'a,b'])
    @component('components.card')`);
  assert.deepEqual(refs.map(ref => resolveBladeReference(ref, 'module::pages')), ['layouts.app', 'module::pages.partials.status', 'components.card']);
});

test('Blade comments, escaped directives, verbatim and PHP strings are ignored', () => {
  assert.deepEqual(bladeReferences(`{{-- @include('hidden') --}}
    @@include('escaped')
    @verbatim @include('hidden') @endverbatim
    @php $x = "@include('hidden')"; @endphp`), []);
});

test('dynamic expressions are never evaluated or partially guessed', () => {
  for (const source of ["@include($unknown.'.x')", "@include(getView())", "@include($view . $suffix)", "@include($view . )"]) {
    const [ref] = bladeReferences(source);
    assert.equal(resolveBladeReference(ref, 'pages'), undefined);
  }
  assert.deepEqual(bladeReferences("@include('unterminated"), []);
});

test('controller rendering current Blade supplies protected view base', async () => {
  const source = `<?php class PendaftarController {
    protected $view = 'tugasakhir::pages.data.pendaftar';
    function show() { return $dataTable->render($this->view.'.show', $pageData); }
  }
  class OtherController {
    protected $view = 'tugasakhir::pages.other';
    function show() { return view($this->view.'.show'); }
  }`;
  const directory = 'Modules/TugasAkhir/resources/views/pages/data/pendaftar';
  const files = [`${directory}/show.blade.php`, `${directory}/partials/status.blade.php`];
  const resolve = name => resolveView(name, {
    isFile: async file => files.includes(file), directories: async () => ['TugasAkhir']
  });
  const bases = await controllerViewBases(analyze(source, true), files[0], resolve);
  assert.deepEqual(bases, ['tugasakhir::pages.data.pendaftar']);
  const [ref] = bladeReferences("@include($view.'.partials.status', ['status' => $status])");
  assert.equal(await resolve(resolveBladeReference(ref, bases[0])), files[1]);
});

test('multiple matching controller bases remain distinct; unrelated views do not match', async () => {
  const refs = [
    { name: 'shared', viewBase: 'one' },
    { name: 'shared', viewBase: 'two' },
    { name: 'shared', viewBase: 'one' },
    { name: 'other', viewBase: 'wrong' }
  ];
  assert.deepEqual(await controllerViewBases(refs, 'resources/views/shared.blade.php', async name => 'resources/views/' + name + '.blade.php'), ['one', 'two']);
});

test('unrelated render calls skip filesystem resolution', async () => {
  let calls = 0;
  const refs = [{ name: 'module::other.index', viewBase: 'module::other' }];
  assert.deepEqual(await controllerViewBases(refs, 'resources/views/pages/show.blade.php', async () => { calls++; }), []);
  assert.equal(calls, 0);
});
