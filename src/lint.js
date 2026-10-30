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
const functionName = call => call.kind === 'call' && call.what?.kind === 'name' ? call.what.name.replace(/^\\/, '').toLowerCase() : undefined;
const staticCall = call => call.kind === 'call' && call.what?.kind === 'staticlookup' ? call.what : undefined;

const INPUT = new Set(['input', 'get', 'post', 'all', 'only', 'except', 'query', 'boolean', 'string', 'integer', 'float', 'date', 'collect', 'validate']);
const DB_ALLOWED_IN_SERVICE = new Set(['transaction', 'begintransaction', 'commit', 'rollback']);
const BRANCHES = { if: 'if', foreach: 'foreach', for: 'for', while: 'while', do: 'do', switch: 'switch' };
// Eager loading a route model for the view is allowed (reference AuditProgramController does it).
const VIEW_LOADING = new Set(['load', 'loadmissing', 'loadcount', 'setrelation', 'getroutekey', 'getkey', 'toarray']);

/** Static checks for the modular Laravel boilerplate (thin controller, service layer, FormRequest, Eloquent only). Never runs PHP. */
// `rules` maps a layer to false to switch its checks off.
function standardIssues(source, { declaresView = false, rules = {} } = {}) {
  let ast;
  try { ast = parser.parseCode(source); } catch { return []; }
  const issues = [];
  let layer;
  const add = (node, severity, message, length) => rules[layer] !== false && node?.loc && issues.push({
    start: node.loc.start.offset, end: length ? node.loc.start.offset + length : node.loc.end.offset, severity, message, layer
  });
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
    return { names, root: receiver?.kind === 'variable' ? receiver.name : undefined, receiver };
  }

  function visitClass(node, qualify, namespace) {
    const statements = node.body || [];
    const methods = statements.filter(s => s.kind === 'method' && s.body);
    const declared = new Set(statements.filter(s => s.kind === 'propertystatement').flatMap(s => s.properties.map(p => p.name.name)));
    const parent = shortName(node.extends);
    const className = node.name?.name || '';
    const isModel = type => /\\Models\\/.test(qualify(type) || '');
    const calls = body => { const found = []; walk(body, current => current.kind === 'call' && found.push(current)); return found; };

    // Eloquent only: no raw SQL or bare query builder anywhere outside migrations.
    layer = 'rawSql';
    if (!/Migration$/.test(className)) walk(node, current => {
      const lookup = staticCall(current);
      const method = (lookup ? lookup.offset?.name : current.what?.offset?.name)?.toLowerCase() || '';
      if (lookup && shortName(lookup.what) === 'DB' && !(/Service$/.test(className) && DB_ALLOWED_IN_SERVICE.has(method))) {
        if (parent === 'Controller') add(lookup, 'warning', `DB::${lookup.offset?.name}() tidak boleh di controller; pindahkan ke service.`);
        else add(lookup, 'warning', `DB::${lookup.offset?.name}() adalah raw query builder; gunakan model, relasi, dan scope Eloquent.`);
      } else if (current.kind === 'call' && /(select|where|having|orderby|groupby|from|join)raw$/.test(method)) {
        add(current.what.offset || current.what, 'warning', `${lookup ? lookup.offset.name : current.what.offset.name}() adalah raw SQL; gunakan Eloquent.`);
      }
    });

    layer = 'dataTable';
    if (/DataTable$/.test(parent)) {
      for (const statement of statements.filter(s => s.kind === 'propertystatement')) {
        for (const property of statement.properties.filter(p => p.name.name === 'tableId')) {
          add(property, 'warning', 'DataTable tidak boleh mendeklarasikan $tableId; nilainya datang dari controller lewat ->with($this->getPageData()).');
        }
      }
      walk(node, current => {
        if (declaresView && !declared.has('view') && thisProperty(current) === 'view') {
          add(current, 'error', '$this->view selalu null di Yajra DataTable (vendor mendeklarasikan protected ?string $view). Gunakan $this->view_path.');
        }
        if (functionName(current) === 'view'
          // Only module page views duplicate the controller's $view; shared partials like components.* are fine.
          && current.arguments?.[0]?.kind === 'string' && /::(?!components\.)/.test(current.arguments[0].value)) {
          add(current.arguments[0], 'info', 'View cell di-hardcode. Gunakan $this->view_path.\'.<partial>\' atau beri komentar alasan partial berada di luar $view controller.');
        }
      });
    }

    for (const method of methods) {
      const tables = new Set((method.arguments || []).filter(arg => /DataTable$/.test(shortName(arg.type))).map(arg => arg.name.name));
      if (!tables.size) continue;
      const chains = calls(method.body).map(call => [call, chain(call)]);
      // ponytail: any with() on the parameter anywhere in the method counts, so split statements don't false-warn.
      const passed = new Set(chains.filter(([, c]) => c.names.includes('with')).map(([, c]) => c.root));
      for (const [call, c] of chains) {
        if (tables.has(c.root) && !passed.has(c.root) && ['render', 'ajax', 'html'].includes(c.names[0])) {
          add(call.what.offset, 'warning', `$${c.root}->${c.names[0]}() tanpa ->with($this->getPageData()); $this->view_path, $this->route dan $this->tableId akan kosong di DataTable.`);
        }
      }
    }

    layer = 'controller';
    const ownView = statements.filter(s => s.kind === 'propertystatement').flatMap(s => s.properties)
      .find(p => p.name.name === 'view')?.value?.value;
    if (parent === 'Controller') {
      const constructor = methods.find(m => m.name?.name === '__construct');
      if (constructor && !calls(constructor.body).some(call => staticCall(call)?.what?.kind === 'parentreference' && staticCall(call).offset?.name === '__construct')) {
        add(constructor.name, 'error', 'Constructor controller wajib memanggil parent::__construct(); tanpa itu middleware permission dan data halaman tidak terdaftar.');
      }
      for (const method of methods) {
        const params = method.arguments || [];
        const baseRequests = new Set(params.filter(arg => qualify(arg.type) === 'Illuminate\\Http\\Request').map(arg => arg.name.name));
        const requests = new Set(params.filter(arg => /Request$/.test(shortName(arg.type))).map(arg => arg.name.name));
        const models = new Set(params.filter(arg => isModel(arg.type)).map(arg => arg.name.name));
        const all = calls(method.body);
        // Report a fluent chain once, at its outermost call.
        const inner = new Set(all.map(call => call.what?.kind === 'propertylookup' ? call.what.what : undefined));
        for (const call of all) {
          if (inner.has(call)) continue;
          const c = chain(call);
          const name = c.names[0];
          const lookup = staticCall(c.receiver);
          if (requests.has(c.root) && c.names.length === 1 && name === 'validate') {
            add(call.what.offset, 'warning', 'Validasi di controller dilarang; pindahkan rules ke FormRequest dan pakai $request->validated().');
          } else if (baseRequests.has(c.root) && c.names.length === 1 && INPUT.has(name?.toLowerCase())) {
            add(call.what.offset, 'warning', `$${c.root}->${name}() membaca input dari Request biasa; buat FormRequest dan pakai $request->validated().`);
          } else if (requests.has(c.root) && c.names.length === 1 && name === 'all') {
            add(call.what.offset, 'warning', '$request->all() dilarang; pakai $request->validated().');
          } else if (functionName(c.receiver) === 'request' && INPUT.has(name?.toLowerCase())
            // guideline §9.1: tabs honor request()->boolean('only_trashed').
            && call.arguments?.[0]?.value !== 'only_trashed') {
            add(call.what.offset, 'warning', `request()->${name}() di controller; terima FormRequest dan pakai $request->validated().`);
          } else if (thisProperty(call.what) === 'validate' || (lookup && shortName(lookup.what) === 'Validator') || functionName(call) === 'validator') {
            add(call.what, 'warning', 'Validasi di controller dilarang; pindahkan ke FormRequest.');
          } else if (thisProperty(call.what) === 'authorize' || (lookup && shortName(lookup.what) === 'Gate')) {
            add(call.what, 'warning', 'Cek permission di controller dilarang; permission datang dari $modules / $actions di base controller.');
          } else if (functionName(c.receiver) === 'response' && name === 'json'
            // guideline §5: tabCounts returns the raw counts the tab JS reads.
            && !/tabcounts$/i.test(method.name?.name)) {
            add(call.what.offset, 'warning', 'response()->json() dilarang; pakai $this->responseService->success(...).');
          } else if (lookup && isModel(lookup.what)) {
            add(lookup, 'warning', `Controller tidak boleh memanggil model (${shortName(lookup.what)}::${lookup.offset?.name}); pindahkan ke service.`);
          } else if (models.has(c.root) && c.names.some(n => !VIEW_LOADING.has(n?.toLowerCase()))) {
            add(call.what.offset, 'warning', `Controller tidak boleh memanggil Eloquent pada $${c.root}; teruskan model ke service.`);
          }
        }
        walk(method.body, current => {
          if (BRANCHES[current.kind]) {
            add(current, 'info', `${BRANCHES[current.kind]} di controller biasanya logika bisnis; pindahkan ke service.`, BRANCHES[current.kind].length);
          }
          const lookup = staticCall(current);
          if (functionName(current) === 'view' || (lookup && shortName(lookup.what) === 'View' && lookup.offset?.name === 'make')) {
            // Leftmost literal of the name, so 'ns::pages.x'.$suffix is caught too.
            let name = current.arguments?.[0];
            while (name?.kind === 'bin' && name.type === '.') name = name.left;
            if (name?.kind === 'string' && name.value.includes('::')) {
              const suffix = typeof ownView === 'string' && name.value.startsWith(ownView + '.') ? name.value.slice(ownView.length) : undefined;
              add(name, 'warning', suffix
                ? `Nama view di-hardcode di controller; gunakan $this->view.'${suffix}'.`
                : `Nama view di-hardcode di controller; gunakan $this->view.'.<nama>', atau beri komentar alasan view berada di luar $view (${ownView ?? 'belum dideklarasikan'}).`);
            }
          }
        });
      }
    }

    // guideline: services live in Modules/<M>/app/Services; app/Services is shared infrastructure.
    layer = 'service';
    if (/Service$/.test(className) && className !== 'BaseService' && /^Modules\\/.test(namespace)) {
      if (!/BaseService$/.test(parent)) add(node.name, 'info', `${className} sebaiknya extends BaseService modul (create/update/delete/findByUuid sudah tersedia).`);
      for (const method of methods) {
        if (/JsonResponse|View$/.test(shortName(method.type))) add(method.type, 'warning', 'Service harus mengembalikan data (model/array/bool/void), bukan response atau view.');
        walk(method.body, current => {
          const lookup = staticCall(current);
          const fn = functionName(current);
          if (fn === 'request' || fn === 'session' || (lookup && ['Request', 'Session'].includes(shortName(lookup.what)))) {
            add(current.what, 'warning', 'Service tidak boleh membaca request/session; terima datanya sebagai parameter dari controller.');
          } else if (fn === 'response' || fn === 'view') {
            add(current.what, 'warning', 'Service tidak boleh membuat response/view; kembalikan data ke controller.');
          }
        });
      }
    }

    layer = 'formRequest';
    if (parent === 'FormRequest') {
      const authorize = methods.find(m => m.name?.name === 'authorize');
      const result = authorize?.body.children.length === 1 && authorize.body.children[0].kind === 'return' ? authorize.body.children[0].expr : undefined;
      if (authorize && !(result?.kind === 'boolean' && result.value === true)) {
        add(authorize.name, 'info', 'authorize() FormRequest harus return true; permission diatur lewat $modules di controller.');
      }
    }

    layer = 'model';
    if (parent === 'Model' && className !== 'BaseModel' && qualify(node.extends) === 'Illuminate\\Database\\Eloquent\\Model') {
      add(node.extends, 'warning', 'Model harus extends App\\Models\\BaseModel (UUID, audit, author stamps).');
    } else if (parent === 'BaseModel' && !declared.has('schema')) {
      add(node.name, 'warning', 'Model wajib mendeklarasikan protected $schema = SCHEMA_*;');
    }
  }

  (function visit(node, namespace, imports) {
    if (node.kind === 'program' || node.kind === 'namespace') {
      namespace = node.kind === 'namespace' ? node.name : '';
      imports = new Map();
      for (const use of node.children.filter(child => child.kind === 'usegroup' && !child.type)) {
        for (const item of use.items) {
          const full = [use.name, item.name].filter(Boolean).join('\\');
          imports.set((item.alias?.name || full.split('\\').at(-1)).toLowerCase(), full);
        }
      }
    }
    if (node.kind === 'class') {
      visitClass(node, type => {
        if (type?.kind !== 'name') return undefined;
        if (type.name.startsWith('\\')) return type.name.slice(1);
        const [first, ...rest] = type.name.split('\\');
        return [imports.get(first.toLowerCase()) || [namespace, first].filter(Boolean).join('\\'), ...rest].join('\\');
      }, namespace);
    }
    for (const child of children(node)) visit(child, namespace, imports);
  })(ast, '', new Map());
  return issues;
}

module.exports = { standardIssues, yajraDeclaresView };
