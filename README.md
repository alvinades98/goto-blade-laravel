# Ades Laravel Blade Navigator

Ekstensi VS Code untuk proyek Laravel modular dengan dua fungsi:

1. **Navigasi Blade.** Buka file Blade dengan **Ctrl+klik** atau **F12 / Go to Definition** dari PHP dan Blade. Di macOS gunakan Cmd+klik.
2. **Pemeriksaan standar boilerplate.** Tandai controller, service, FormRequest, model, dan Yajra DataTable yang menyimpang dari boilerplate (thin controller, service layer, validasi lewat FormRequest, Eloquent only, `getPageData() → with() → $this->view_path`). Hasilnya muncul langsung di editor, di panel Problems, dan di panel samping khusus.

## Contoh

```php
protected $view = 'mahasiswa::pages.tugas-akhir';

return $dataTable->render($this->view.'.bimbingan', $pageData);
```

Klik pada `$this->view` atau `'.bimbingan'` di argumen `render()` untuk membuka:

```text
Modules/Mahasiswa/resources/views/pages/tugas-akhir/bimbingan.blade.php
```

## Instalasi

1. Di VS Code buka Extensions (Ctrl+Shift+X).
2. Pilih menu **… → Install from VSIX…**.
3. Pilih `alvinade98-laravel-blade-navigator-0.1.4.vsix`.
4. Buka folder proyek Laravel, buka controller, lalu Ctrl+klik ekspresi view. Bila diperlukan jalankan **Developer: Reload Window**.

Atau melalui terminal:

```sh
code --install-extension alvinade98-laravel-blade-navigator-0.1.4.vsix
```

## Navigasi Blade

- **Yajra DataTables.** Mendukung `view($this->view_path.'.action', ...)` dan `view($this->view.'.action', ...)` di file dalam direktori `DataTables`. Nilainya diambil dari controller yang mengirimkannya lewat salah satu bentuk berikut:
  - rantai `with($this->getPageData())->render(...)`, termasuk metode lain di antaranya seperti `->forScope($x)->with(...)`;
  - metode pembungkus yang mengembalikan `getPageData()`, termasuk tambahan array dengan `+`;
  - `with($this->pageData)`;
  - `with('view_path', ...)`, `with(['view_path' => ...])`, `with('view', ...)`, atau `with(['view' => ...])`.

  Pencocokan memakai namespace kelas dan tipe parameter method, termasuk alias import.
- **Blade.** Mendukung `@include`, `@includeIf`, `@extends`, dan `@component`, termasuk `$view.'.partials.status'`. Ekstensi mencari controller yang me-render Blade saat ini, lalu mengambil nilai default `protected $view` dari kelas tersebut. Ini mengikuti konvensi aplikasi yang membagikan properti controller sebagai variabel `$view` di Blade.
- **Pemanggilan view.** Mendukung `view('pages.index')`, `View::make('pages.index')`, `response()->view(...)`, dan `->render(...)`.
- **Gabungan string.** Mendukung gabungan string literal dan properti `$this` yang punya nilai default statis di kelas yang sama, termasuk spasi, baris baru, dan tanda kurung.
- **Lokasi view.**
  - View biasa di `resources/views`.
  - Namespace modul yang cocok dengan nama direktori di `Modules` (tanpa membedakan huruf besar-kecil), dengan folder `resources/views` atau `Resources/views`.
  - Override di `resources/views/vendor/<namespace>` dan `resources/views/modules/<namespace>`, yang diperiksa lebih dulu daripada folder modul.
- **Struktur proyek.** Untuk proyek bersarang, ekstensi memakai direktori `artisan` terdekat di dalam workspace. Multi-root workspace juga didukung.

Untuk namespace atau lokasi khusus, atur `.vscode/settings.json` di proyek Laravel. Path ditulis relatif terhadap root proyek, dan urutannya menentukan prioritas:

```json
{
  "laravelBladeNavigator.namespaces": {
    "mahasiswa": ["Modules/Mahasiswa/resources/views"],
    "custom": ["features/custom/views"]
  }
}
```

## Pemeriksaan standar boilerplate

File PHP di `app/` dan `Modules/` diperiksa saat dibuka dan setiap kali diedit. Folder `database/`, `vendor/`, dan file Blade dilewati. Temuan punya tiga tingkat:

- **Error** untuk kode yang pasti rusak saat runtime.
- **Warning** untuk pelanggaran boilerplate.
- **Info** untuk kode yang sebaiknya ditinjau.

### Panel samping

Klik ikon **Standar Boilerplate** di activity bar. Saat pertama kali dibuka, panel otomatis memindai seluruh workspace. Isi panel:

- **Daftar file** yang belum sesuai standar. Klik sebuah temuan untuk langsung ke barisnya.
- **Badge** di ikon activity bar berisi jumlah temuan.
- Tombol di judul panel:
  - **list-tree / list-flat**: berpindah antara tampilan folder (seperti Explorer) dan daftar yang diurutkan dari temuan paling parah. Pilihan ini diingat per workspace.
  - **⟳**: memindai ulang seluruh workspace.
  - **⚙**: membuka pengaturan aturan per layer.

Pemindaian juga bisa dijalankan dari Command Palette dengan perintah **Laravel Blade Navigator: Scan file yang belum sesuai standar boilerplate**.

### Aturan

| Layer | Tingkat | Yang diperiksa |
|---|---|---|
| Controller | Error | Constructor tanpa `parent::__construct()`, sehingga middleware permission tidak terdaftar |
| Controller | Warning | `$request->validate()`, `$this->validate()`, `Validator::make`, `validator()` |
| Controller | Warning | Input dari `Request` biasa (`input`, `query`, `all`, …), `$request->all()`, `request()->input()` |
| Controller | Warning | `Model::where/query/…`, query atau perubahan data pada route model, `DB::` |
| Controller | Warning | `$this->authorize()`, `Gate::`, `response()->json()` |
| Controller | Warning | Nama view di-hardcode, seperti `view('ns::pages.x.index')`. Gunakan `$this->view.'.index'`. |
| Controller | Info | `if`, `foreach`, `for`, `while`, `switch`, yang biasanya logika bisnis |
| Service | Warning | Membaca `request()` atau `session()`, membuat `response()` atau `view()`, return type `JsonResponse` atau `View` |
| Service | Info | Tidak extends `BaseService` |
| FormRequest | Info | `authorize()` tidak `return true` |
| Model | Warning | Extends `Model` langsung, bukan `BaseModel`; `BaseModel` tanpa `$schema` |
| DataTable | Error | `$this->view` dipakai, padahal Yajra di `vendor/` mendeklarasikan `protected ?string $view`, sehingga nilainya selalu `null` |
| DataTable | Warning | Mendeklarasikan `$tableId`; controller memanggil `render()`, `ajax()`, atau `html()` tanpa `->with($this->getPageData())` |
| DataTable | Info | View cell modul di-hardcode, misalnya `view('ns::pages.x.action')` |
| Raw SQL | Warning | `DB::table/select/statement/raw` dan `selectRaw`, `whereRaw`, `orderByRaw`, dan sejenisnya di semua layer. `DB::transaction` tetap boleh di service. |

Pola berikut sengaja tidak ditandai, karena dipakai oleh contoh di boilerplate:

- `loadMissing` / `setRelation` pada route model;
- `request()->boolean('only_trashed')`;
- `response()->json()` di method `tabCounts`;
- service di `app/Services`, yang merupakan infrastruktur bersama;
- kelas migration helper.

### Pengaturan

Buka dengan tombol **⚙** di panel samping, atau `Ctrl+,` lalu cari `laravelBladeNavigator`. Setiap layer bisa diaktifkan atau dinonaktifkan di tab **User** (berlaku untuk semua proyek) atau tab **Workspace** (per proyek):

```json
{
  "laravelBladeNavigator.dataTableDiagnostics": true,
  "laravelBladeNavigator.rules.controller": true,
  "laravelBladeNavigator.rules.service": true,
  "laravelBladeNavigator.rules.formRequest": true,
  "laravelBladeNavigator.rules.model": true,
  "laravelBladeNavigator.rules.dataTable": true,
  "laravelBladeNavigator.rules.rawSql": true
}
```

`dataTableDiagnostics` adalah saklar utama untuk mematikan semua pemeriksaan sekaligus. Setelah pengaturan berubah, file yang terbuka langsung diperiksa ulang. Bila sebelumnya sudah pernah dipindai, pemindaian berjalan ulang otomatis.

## Batasan

**Navigasi:**
- Analisis bersifat statis dan tidak menjalankan PHP.
- Penelusuran DataTables mengikuti konvensi `pageData/getPageData` yang membagikan properti `view` controller. Pemanggilan `with()` yang terpisah dari rantai `render()`, injeksi lewat variabel lokal, kelas induk atau trait, dan perubahan nilai saat runtime belum ditelusuri.
- Nilai yang tidak diresolusikan: dari constructor, variabel lokal, kelas induk, trait, pemanggilan fungsi, interpolasi, dan properti yang diubah.
- Namespace yang didaftarkan secara dinamis lewat service provider perlu dikonfigurasi manual.
- Untuk `$view` di Blade, controller harus berada di `app` atau `Modules`, bernama `*Controller.php`, dan me-render Blade tersebut secara langsung. Pewarisan konteks dari include ke partial bertingkat dan penimpaan `$view` di dalam template belum didukung.
- Controller di modul yang sama diprioritaskan. Bila tidak ditemukan, pencarian dilanjutkan ke seluruh proyek.
- Bila beberapa controller membuka Blade yang sama, F12 menampilkan semua tujuan yang ditemukan. Ctrl+klik lewat tautan dokumen hanya tersedia bila tujuannya tunggal.
- Provider lain seperti Intelephense bisa menambahkan hasil definisinya sendiri, sehingga VS Code menampilkan pilihan tujuan.

**Pemeriksaan:**
- Aturan mengikuti satu konvensi boilerplate tertentu. Di proyek dengan konvensi lain, nonaktifkan layer yang tidak relevan di pengaturan Workspace.
- Peran kelas dikenali dari namanya: extends `Controller`, nama berakhiran `Service`, extends `FormRequest`, extends `Model` / `BaseModel`, dan extends `*DataTable`.
- Aturan yang butuh konteks lintas file belum diperiksa, yaitu permission di routes, query di Blade, dan isi migration.
- Hasil untuk file yang tertutup diperbarui lewat pemindaian ulang. Status deklarasi `$view` di `vendor/` Yajra dibaca sekali per sesi, jadi jalankan **Developer: Reload Window** setelah mengubah vendor.

## Pengembangan

```sh
npm ci
npm test
npm run package
```

Tekan F5 untuk membuka Extension Development Host. Buka proyek Laravel di jendela tersebut lalu coba Ctrl+klik, F12, dan panel **Standar Boilerplate**. Pengujian otomatis memeriksa analisis PHP, resolusi path, dan aturan pemeriksaan. Interaksi mouse dan tampilan panel perlu diuji langsung di VS Code.

Implementasi memakai [VS Code Definition Provider](https://code.visualstudio.com/api/language-extensions/programmatic-language-features), [Diagnostics](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#provide-diagnostics), [Tree View](https://code.visualstudio.com/api/extension-guides/tree-view), dan [php-parser](https://github.com/glayzzle/php-parser).
