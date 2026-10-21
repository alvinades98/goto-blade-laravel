# Ades Laravel Blade Navigator

Ekstensi VS Code untuk membuka Blade dengan **Ctrl+klik** atau **F12 / Go to Definition** dari PHP. Di macOS gunakan Cmd+klik.

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
3. Pilih `alvinade98-laravel-blade-navigator-0.1.1.vsix`.
4. Buka folder proyek Laravel, buka controller, lalu Ctrl+klik ekspresi view. Bila diperlukan jalankan **Developer: Reload Window**.

Atau melalui terminal:

```sh
code --install-extension alvinade98-laravel-blade-navigator-0.1.1.vsix
```

## Dukungan

- Yajra DataTables: `view($this->view.'.action', ...)` di file dalam direktori `DataTables`, saat `$view` dikirim oleh controller melalui rantai `with($this->getPageData())->render(...)`, `with($this->pageData)`, atau `with('view', ...)` / `with(['view' => ...])`. Pencocokan menggunakan namespace kelas dan tipe parameter method, termasuk alias import.

- Blade: `@include`, `@includeIf`, `@extends`, dan `@component`, termasuk `$view.'.partials.status'`. Ekstensi mencari controller yang me-render Blade saat ini, lalu mengambil nilai default `protected $view` dari kelas tersebut. Ini mengikuti konvensi aplikasi yang membagikan properti controller sebagai variabel `$view` di Blade.

- `view('pages.index')`, `View::make('pages.index')`, `response()->view(...)`, dan `->render(...)`.
- Gabungan string literal dan properti `$this` yang memiliki nilai default statis pada kelas yang sama; mendukung spasi, baris baru, dan tanda kurung.
- View biasa di `resources/views`.
- Namespace modul yang cocok dengan nama direktori di `Modules` (tanpa membedakan kapital), dengan folder `resources/views` atau `Resources/views`.
- Override di `resources/views/vendor/<namespace>` dan `resources/views/modules/<namespace>` diperiksa sebelum folder modul.
- Proyek bersarang: memakai direktori `artisan` terdekat di dalam workspace. Mendukung multi-root workspace.

Untuk namespace atau lokasi khusus, atur `.vscode/settings.json` di proyek Laravel. Path relatif terhadap root proyek; urutan path menentukan prioritas:

```json
{
  "laravelBladeNavigator.namespaces": {
    "mahasiswa": ["Modules/Mahasiswa/resources/views"],
    "custom": ["features/custom/views"]
  }
}
```

## Batasan

Analisis bersifat statis dan tidak menjalankan PHP. Penelusuran DataTables mengikuti konvensi `pageData/getPageData` yang membagikan properti `view` controller; pemanggilan `with()` terpisah dari rantai `render()`, injeksi lewat variabel lokal, kelas induk/trait, dan perubahan nilai saat runtime belum ditelusuri. Nilai dari constructor, variabel lokal, kelas induk, trait, pemanggilan fungsi, interpolasi, dan properti yang diubah tidak diresolusikan. Registrasi namespace dinamis melalui service provider perlu konfigurasi manual. Untuk `$view` di Blade, controller harus berada di `app` atau `Modules`, bernama `*Controller.php`, dan me-render Blade tersebut secara langsung. Pewarisan konteks dari include ke partial bertingkat dan penimpaan `$view` di dalam template belum didukung. Controller dalam modul yang sama diprioritaskan; bila tidak ditemukan, pencarian dilanjutkan ke seluruh proyek. Bila beberapa controller dalam cakupan pencarian membuka Blade yang sama, F12 menampilkan semua tujuan yang ditemukan. Ctrl+klik melalui tautan dokumen tersedia bila tujuannya tunggal. Provider lain seperti Intelephense bisa menambahkan hasil definisi mereka sendiri sehingga VS Code menampilkan pilihan tujuan.

## Pengembangan

```sh
npm ci
npm test
npm run package
```

Tekan F5 untuk membuka Extension Development Host. Buka proyek Laravel di jendela tersebut dan coba Ctrl+klik atau F12. Pengujian otomatis memeriksa analisis PHP dan resolusi path; interaksi mouse perlu diuji di VS Code.

Implementasi memakai [VS Code Definition Provider](https://code.visualstudio.com/api/language-extensions/programmatic-language-features) dan [php-parser](https://github.com/glayzzle/php-parser).
