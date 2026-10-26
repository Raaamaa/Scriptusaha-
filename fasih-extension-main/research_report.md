# LAPORAN HASIL RISET & AUDIT TEKNIS PRA-IMPLEMENTASI (EDISI REVISI & TERVERIFIKASI)

> **Proyek**: Otomasi Ekstensi FASIH Batch — Penyesuaian Usaha CAWI (Keluarga SE2026)  
> **Wilayah Target**: Kecamatan Slawi, Kabupaten Tegal (`Target Penyisiran Slawi.xlsx`)  
> **Integritas Excel Asli**: SHA256 `4BF4CC211DFF043A92AB785603852335F2CEBD833682C034C8CD4F3CB055E668` (100% Utuh / Tidak Berubah)  
> **Mode Operasi**: STRICTLY READ-ONLY (Nol Operasi Tulis ke FASIH, Nol Request Mutasi/Commit)  
> **Perlindungan Data**: Zero PII (Seluruh Nama KK, Nama Usaha, Nama Pengusaha, NIK, dan Alamat Asli Disamarkan/Dihash)

---

## 1. TEMUAN KRITIS & KOREKSI SITASI

1. **KRITIS #1 — Kolom R (`Nama Usaha`) KOSONG pada 87,2% Target Bangunan Campuran:**
   - **Fakta Data:** Dari 3.155 baris `2. Bangunan Campuran` (2.637 keluarga unik), sebanyak **2.750 baris (87,2%) memiliki Kolom R (`Nama Usaha`) KOSONG TOTAL!** Hanya 405 baris (368 keluarga unik) yang memiliki Kolom R terisi `[EXCEL r5_output.txt:55, r4_campuran_output.txt:26]`.
   - **Kontradiksi Desain:** Pada `implementation_plan.md` (Layer 1): `if (!row.nama_usaha) return { skip: true, ket: 'Kolom nama_usaha di Excel kosong' }`.
   - **Dampak Fatal:** Jika aturan ini dijalankan apa adanya, **87,2% target Bangunan Campuran langsung dilewati**. Hanya maksimal 299 keluarga (11,3%) yang dapat diproses.
   - **Gugurnya Asumsi Baseline:** Asumsi PRD bahwa ±82,9% (2.186 keluarga) otomatis masuk Skenario A **GUGUR SECARA FAKTUAL**. Angka 2.186 adalah jumlah baris Excel per ID, bukan jumlah keluarga yang memiliki nama usaha di Excel.

2. **KRITIS #2 — Server FASIH Mem-Bypass Validasi FormGear (Server-Side Bypass):**
   - **Fakta Kode:** Komentar arsitektur di `lib/general_console.js:19-24` menyatakan: *"SERVER TIDAK MEMVALIDASI ISI DOKUMEN... ZIP DIKIRIM LANGSUNG KE S3 DAN COMMIT DITERIMA TANPA PENGECEKAN ATURAN FORMGEAR"*.
   - **Bahaya Tersembunyi:** Jika script hanya mengubah Blok P ke "2" tanpa menghapus baris roster Blok II di `data.answers`, server FASIH **tetap menerima commit**. Namun, saat dokumen dibuka di web oleh pengawas/PML, engine FormGear akan memicu **tanda seru merah (!)** akibat inkonsistensi jawaban yatim (*orphan answers*) `[KODE lib/general_console.js:19-24]` dan `[WEB https://github.com/bps-statistics/form-gear/blob/8ccbe8e/src/formGenerator/libs/GlobalFunction.tsx#L840-L864, diakses 2026-10-23] [KOREKSI SITASI: bersumber dari repositori upstream resmi FormGear BPS, diteliti via salinan audit scratch/formgear_src/GlobalFunction.tsx]`.

3. **KRITIS #3 — Perilaku `setAnswer` Menambah Key Baru Secara Diam-Diam:**
   - **Fakta Kode:** Implementasi `setAnswer(doc, k, v)` pada `lib/general_console.js:368-398` (yang dioper sebagai `set` di baris 300) tidak memvalidasi keberadaan key di skema kuesioner. Jika key belum ada di dokumen, baris 396 (`doc.answers.push({ dataKey: k, answer: val })`) **langsung menambahkan objek key baru ke `data.answers`** secara diam-diam `[KODE lib/general_console.js:368-398, baris 396] [KOREKSI SITASI: laporan sebelumnya keliru mencatat L145 yang sebenarnya merupakan baris di fungsi init()]`.
   - **Bahaya:** Jika script menggunakan nama `dataKey` yang salah ketik atau belum terverifikasi skema resminya, dokumen survei resmi BPS akan tercemar oleh field fiktif `[KODE lib/general_console.js:396]`.

4. **KRITIS #4 — Runner Ekstensi Tidak Memiliki Mekanisme Abort Otomatis dari Script:**
   - **Fakta Kode:** Variabel `abort` berada pada scope tertutup `panel.js:441, 493`. Script di dalam `process()` tidak bisa menghentikan runner jika mendeteksi anomali massal. Melempar error (`throw`) hanya menandai 1 baris sebagai `GAGAL` dan runner tetap lanjut ke baris berikutnya `[KODE panel.js:510-536]`.

---

## 2. RINGKASAN EKSEKUTIF

Audit teknis mendalam telah diselesaikan terhadap ekstensi FASIH Batch, repositori resmi upstream FormGear BPS (`bps-statistics/form-gear`), dan salinan file `Target Penyisiran Slawi.xlsx`. Nilai SHA256 file Excel asli diverifikasi tetap identik (`4BF4CC211DFF...`), server FASIH live tidak dikirimi request tulis, dan folder audit bersih dari PII.

Temuan data membuktikan bahwa dari 2.637 keluarga Bangunan Campuran, hanya **299 keluarga (11,3%)** yang memiliki nama usaha di Kolom R Excel dan muncul 1 kali. Angka 299 ini adalah **batas atas teoretis**, bukan perkiraan lolos OK, karena masih harus melewati 5 lapisan filter dokumen FASIH (status assignment, usaha pertanian di Blok P, jumlah usaha riil, kecocokan nama, dan konsistensi KK). Sebanyak **1.887 keluarga (71,6%)** memiliki Kolom R kosong dan sama sekali tidak memiliki rincian pengusaha di Kolom S/T/U/V. FormGear terbukti tidak membersihkan jawaban yatim saat komponen dinonaktifkan, sehingga script wajib menghapus seluruh key roster `#n` dan memperbarui field agregat secara eksplisit. Script otomasi **BELUM DITULIS** dan ditunda menunggu keputusan bisnis pengguna.

---

## 3. VERIFIKASI SITASI KODE LENGKAP (KOREKSI SITASI)

Berikut adalah daftar koreksi dan verifikasi seluruh sitasi kode yang ada pada laporan sebelumnya:

1. **Sitasi `set()` dan `setAnswer()`:**
   - *Laporan Sebelumnya:* `lib/general_console.js:145` (SALAH, baris 145 adalah pengecekan ID di dalam fungsi `init()`).
   - *Koreksi Terverifikasi:* **`lib/general_console.js:368-398`** (fungsi `setAnswer(doc, k, v)`). Pemanggilan `set` dioper pada baris 300 (`mutate(doc, { set: (k, v) => setAnswer(doc, k, v), ... })`). Baris penambahan key baru diam-diam berada persis di **`lib/general_console.js:396`** (`doc.answers.push({ dataKey: k, answer: val })`) `[KODE lib/general_console.js:368-398, baris 396] [KOREKSI SITASI]`.
2. **Sitasi Upstream FormGear (`GlobalFunction.tsx` & `ValidationStore.tsx`):**
   - *Laporan Sebelumnya:* Dilabeli sebagai file workspace lokal `scratch/formgear_src/...`.
   - *Koreksi Terverifikasi:* Kode tersebut berasal dari repositori resmi open-source BPS FormGear. Label bukti dikoreksi menjadi:
     - `[WEB https://github.com/bps-statistics/form-gear/blob/8ccbe8e/src/formGenerator/libs/GlobalFunction.tsx#L840-L864, diakses 2026-10-23] [KOREKSI SITASI]`.
     - `[WEB https://github.com/bps-statistics/form-gear/blob/8ccbe8e/src/formGenerator/stores/ValidationStore.tsx#L90-L120, diakses 2026-10-23] [KOREKSI SITASI]`.
     - `[WEB https://github.com/bps-statistics/form-gear/blob/8ccbe8e/src/formGenerator/Form.tsx#L115-L140, diakses 2026-10-23] [KOREKSI SITASI]`.
     - `[WEB https://github.com/bps-statistics/form-gear/blob/8ccbe8e/src/formGenerator/components/inputs/nested/NestedInput.tsx, diakses 2026-10-23] [KOREKSI SITASI]`.
3. **Sitasi Tanda Tangan Runner `panel.js`:**
   - *Laporan Sebelumnya:* `await process(row, i, sheetData)` di `panel.js:516`.
   - *Koreksi Terverifikasi:* **`panel.js:515`** memanggil `await m.process(item, { ...ctx, index: i, rowNumber: r + 1, remarks })` dengan `ctx` dibentuk di baris 492 (`{ dryRun: dry, options: { ...S }, FASIH: F(), sleep, total: targets.length }`) `[KODE panel.js:492, 515] [KOREKSI SITASI]`.
4. **Sitasi Pembuatan Backup Ekstensi:**
   - *Laporan Sebelumnya:* Menyebutkan backup dibuat di dalam `submitEdit` pada `lib/general_console.js:275`.
   - *Koreksi Terverifikasi:* Backup dibuat di level runner batch pada **`panel.js:506-509`** sebelum iterasi baris dimulai dengan memanggil `FASIH.backup(ids, filename)` yang didefinisikan pada **`lib/general_console.js:427-440`**. Backup disimpan sebagai satu file unduhan JSON utuh, bukan key individual `[KODE panel.js:506-509, lib/general_console.js:427-440] [KOREKSI SITASI]`.

---

## 4. PROFIL KOLOM EXCEL LENGKAP (BANGUNAN CAMPURAN)

Berdasarkan analisis terverifikasi pada salinan Excel (3.155 baris, 2.637 keluarga unik Bangunan Campuran) `[EXCEL evidence/r4_campuran_output.txt]`:

### A. Persentase Terisi Setiap Kolom (A s.d. W)
Dipisahkan antara keluarga 1-baris (2.186 keluarga, 2.186 baris) vs keluarga multi-baris (451 keluarga, 969 baris):

| Kolom | Nama Header | Total Campuran (3.155 baris) | Keluarga 1-Baris (2.186 baris) | Keluarga Multi-Baris (969 baris) | Keterangan & Makna Kolom |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **A** | `assignment_id` | 3.155 (100,0%) | 2.186 (100,0%) | 969 (100,0%) | Kunci unik dokumen di FASIH (UUID v4) |
| **B** | `geotag_latitude` | 3.154 (100,0%) | 2.185 (100,0%) | 969 (100,0%) | Koordinat lintang lokasi bangunan |
| **C** | `geotag_longitude` | 3.154 (100,0%) | 2.185 (100,0%) | 969 (100,0%) | Koordinat bujur lokasi bangunan |
| **D** | `kec` | 3.155 (100,0%) | 2.186 (100,0%) | 969 (100,0%) | Kode & Nama Kecamatan (`[100] SLAWI`) |
| **E** | `desa` | 3.155 (100,0%) | 2.186 (100,0%) | 969 (100,0%) | Kode & Nama Desa/Kelurahan (10 desa) |
| **F** | `kode_sls` | 3.153 (99,9%) | 2.184 (99,9%) | 969 (100,0%) | Kode Satuan Lingkungan Setempat (RT/RW) |
| **G** | `nama_sls` | 3.155 (100,0%) | 2.186 (100,0%) | 969 (100,0%) | Uraian nama SLS / RT / RW |
| **H** | `nama_usaha_bang` | **0 (0,0%)** | **0 (0,0%)** | **0 (0,0%)** | **KOSONG TOTAL** (Hanya terisi pada BKU) |
| **I** | `no_bang` | 3.154 (100,0%) | 2.185 (100,0%) | 969 (100,0%) | Nomor urut bangunan sensus fisik |
| **J** | `nama_kk` | 3.153 (99,9%) | 2.184 (99,9%) | 969 (100,0%) | Nama Kepala Keluarga (Prelist/Pencacahan) |
| **K** | `kode_bang_label` | 3.155 (100,0%) | 2.186 (100,0%) | 969 (100,0%) | `2. Bangunan Campuran` (100% homogen) |
| **L** | `catatan` | 1.892 (60,0%) | 1.314 (60,1%) | 578 (59,6%) | Catatan lapangan petugas pencacah |
| **M** | `JK_label(1)` | **0 (0,0%)** | **0 (0,0%)** | **0 (0,0%)** | **KOSONG TOTAL** pada Campuran (kolom BKU) |
| **N** | `umur(1)` | **0 (0,0%)** | **0 (0,0%)** | **0 (0,0%)** | **KOSONG TOTAL** pada Campuran (kolom BKU) |
| **O** | `nik_pengusaha(1)` | **0 (0,0%)** | **0 (0,0%)** | **0 (0,0%)** | **KOSONG TOTAL** pada Campuran (kolom BKU) |
| **P** | `Petugas` | 3.154 (100,0%) | 2.186 (100,0%) | 968 (99,9%) | ID / Nama Petugas Pencacah Lapangan |
| **Q** | `Kode Identifier` | 414 (13,1%) | 302 (13,8%) | 112 (11,6%) | Kode identifikasi usaha BPS / SBR |
| **R** | `Nama Usaha` | **405 (12,8%)** | **299 (13,7%)** | **106 (10,9%)** | **Nama Usaha CAWI (Kunci Utama Pencocokan)** |
| **S** | `Nama Pengusaha` | 402 (12,7%) | 296 (13,5%) | 106 (10,9%) | Nama pengelola/pemilik usaha |
| **T** | `JK_label(2)` | 402 (12,7%) | 296 (13,5%) | 106 (10,9%) | Jenis kelamin pengusaha |
| **U** | `umur(2)` | 402 (12,7%) | 296 (13,5%) | 106 (10,9%) | Umur pengusaha |
| **V** | `nik_pengusaha(2)` | 402 (12,7%) | 296 (13,5%) | 106 (10,9%) | NIK pengusaha (tersedia jika S terisi) |
| **W** | *(header kosong)* | 1.176 (37,3%) | 815 (37,3%) | 361 (37,3%) | Kolom catatan tambahan lokal tim penyisir |

### B. Analisis Mendalam 1.887 Keluarga 1-Baris dengan Kolom R Kosong
Dari 2.186 keluarga Campuran 1-baris, terdapat **1.887 keluarga (86,3%)** yang Kolom R (`Nama Usaha`) kosong. Status kolom lainnya pada 1.887 keluarga ini adalah:
- **Kolom S (`Nama Pengusaha`):** Hanya terisi **1 baris (0,1%)**, sebanyak 1.886 baris (99,9%) KOSONG.
- **Kolom T, U, V (`JK`, `umur`, `NIK pengusaha`):** Hanya terisi **1 baris (0,1%)**, 99,9% KOSONG.
- **Kolom Q (`Kode Identifier`):** Hanya terisi **6 baris (0,3%)**, 99,7% KOSONG.
- **Kolom H, M, N, O:** KOSONG TOTAL (0 baris terisi).
- **Kolom J (`nama_kk`):** Terisi **1.885 baris (99,9%)**.
- **Kolom B/C (`geotag`) & I (`no_bang`):** Terisi **1.886 baris (99,9%)**.
- **Kolom L (`catatan`):** Terisi **1.132 baris (60,0%)**.
- **Kolom W:** Terisi **781 baris (41,4%)**. Kata awal terbanyak di Kolom W mencakup: `ADA` (166), `USAHA` (125), `TIDAK` (81), `TDK` (17), `DONE(CAWI)` (17), `BUKAN` (9).

### C. Identifikasi Kolom Pengaman Alternatif
Karena Kolom R, S, Q, dan V hampir seluruhnya kosong pada 1.887 keluarga tersebut, verifikasi identitas tidak dapat mengandalkan atribut usaha dari Excel. Kolom pengaman alternatif yang tersedia di Excel untuk mencocokkan dokumen FASIH adalah:
1. **Nama Kepala Keluarga (Kolom J):** Wajib cocok persis antara Excel Kolom J dan `nama_kk` / `dtsen_nama_kk` di dokumen FASIH.
2. **Wilayah Administrasi Lengkap (Kolom D, E, F):** Kecamatan, Desa, dan Kode SLS wajib cocok 100% dengan metadata assignment di FASIH.
3. **Nomor Bangunan Sensus (Kolom I):** Nomor bangunan di Excel wajib cocok dengan `no_bangunan` di dokumen FASIH.

---

## 5. MODEL CAKUPAN DAN REKONSILIASI KELUARGA

Berikut adalah pemodelan estimasi distribusi 2.637 keluarga Bangunan Campuran di Kecamatan Slawi ke tiap jalur eksekusi:

| Jalur Eksekusi | Kriteria / Alasan Pemisahan | Estimasi Jumlah Keluarga | % dari Total Campuran (2.637) | Tingkat Kepastian |
| :--- | :--- | :---: | :---: | :---: |
| **Jalur Skenario B (Multi-Baris)** | Muncul >1 baris di Excel (keluarga multi-usaha) | **451** | 17,1% | **TINGGI (Faktual)** |
| **Jalur LEWATI (Nama Kosong - Opsi A)** | 1 baris Excel, tetapi Kolom R (`Nama Usaha`) KOSONG | **1.887** | 71,6% | **TINGGI (Faktual)** |
| **Jalur Kandidat Skenario A (Batas Atas)** | 1 baris Excel, Kolom R & Kolom J terisi lengkap | **299** | **11,3% (Batas Atas)** | **TINGGI (Faktual)** |
| ↳ *Prediksi LEWATI: Status Tidak Valid* | Dokumen FASIH berstatus `SUBMITTED` / `APPROVED` | ~15 – 35 | 0,6% – 1,3% | SEDANG |
| ↳ *Prediksi LEWATI: Sektor Pertanian* | Blok P memuat subsektor pertanian bernilai "Ya" | ~15 – 35 | 0,6% – 1,3% | SEDANG |
| ↳ *Prediksi LEWATI: Usaha FASIH != 1* | Dokumen FASIH ternyata mencatat 0 usaha atau >1 usaha | ~15 – 30 | 0,6% – 1,1% | SEDANG |
| ↳ *Prediksi LEWATI: Nama Tidak Cocok* | Nama usaha di Excel beda ejaan/kata dengan FASIH | ~30 – 60 | 1,1% – 2,3% | SEDANG |
| ↳ *Prediksi LEWATI: Beda Nama KK* | Nama KK di Excel tidak cocok dengan FASIH | ~5 – 10 | 0,2% – 0,4% | SEDANG |
| **Perkiraan Akhir Berstatus OK (Skenario A)** | **Lolos seluruh verifikasi nama & pengaman** | **~140 – 210** | **5,3% – 8,0%** | **REALISTIS** |

> [!IMPORTANT]
> **PENEGASAN BATAS ATAS:** Angka **299 keluarga** adalah **BATAS ATAS MAKSIMAL**, BUKAN perkiraan jumlah keluarga yang akan berstatus OK! Setelah disaring oleh aturan status, pertanian, jumlah usaha, dan kecocokan nama di FASIH, jumlah dokumen yang berhasil dimutasi diperkirakan berkisar antara **140 hingga 210 keluarga**. Klaim awal bahwa "±83% diproses otomatis" secara teknis tidak dapat dipertahankan.

---

## 6. PROTOKOL VALIDASI EMPIRIS KOLOM R KOSONG (READ-ONLY)

Untuk memutuskan apakah 1.887 keluarga dengan Kolom R kosong aman diproses (Opsi B) atau wajib dilewati (Opsi A), dirancang protokol validasi empiris tanpa operasi tulis ke server FASIH:

### A. Dry Run Read-Only pada 299 Keluarga Bernama
1. Jalankan script batch dengan flag `dryRun: true` khusus pada 299 baris keluarga yang Kolom R-nya terisi.
2. Ukur metrik:
   - Tingkat kecocokan nama eksak (*exact match*) vs kecocokan normalisasi.
   - Distribusi ketidakcocokan: akibat singkatan (mis. "TB" vs "Toko Bangunan"), perbedaan nama panggilan usaha, atau perbedaan usaha total.
   - Persentase dokumen yang berstatus tertutup (`SUBMITTED`/`APPROVED`) dan persentase yang memiliki usaha pertanian di Blok P.
3. **Identifikasi Bias Sampel:** 299 keluarga ini memiliki bias inheren (responden/petugas yang mencatat nama lengkap). Usaha pada 1.887 keluarga kosong kemungkinan didominasi sektor informal tanpa merek komersial.

### B. Audit Manual di UI FASIH pada Sampel ~30 Keluarga Kolom R Kosong
Pengguna membuka 30 dokumen keluarga Campuran yang Kolom R-nya kosong langsung pada web FASIH:
- **Komposisi Sampel Terstratifikasi:**
  - 10 sampel dari keluarga yang Kolom W-nya terisi (termasuk yang mencatat `DONE(CAWI)` / `ADA`).
  - 10 sampel dari keluarga yang Kolom L (`catatan`) terisi.
  - 10 sampel dari keluarga dengan kolom atribut kosong murni.
  - Sampel disebar di 5 desa berbeda (Trayeman, Slawi Wetan, Procot, Kalisapu, Pakembaran).
- **Form Pencatatan Hasil Audit Manual:**
  ```
  [No] [Assignment ID (masked)] [Desa/SLS] [Status FASIH] [Jml Usaha di FASIH] [Nama Usaha di FASIH] [Pengusaha di FASIH == KK?] [Ada Pertanian?] [Catatan Lapangan]
  ```

### C. Kriteria Tertulis Penerimaan / Penolakan Opsi B
- **Opsi B Boleh Dipertimbangkan JIKA DAN HANYA JIKA:**
  1. Hasil audit 30 sampel membuktikan bahwa **$\ge$ 90% sampel** di FASIH mencatat **tepat 1 usaha keluarga non-pertanian**.
  2. Pengusaha yang tercatat di FASIH adalah Kepala Keluarga (Kolom J) atau ART dari keluarga yang bersangkutan.
  3. Ada konfirmasi tertulis dari penanggung jawab teknis BPS bahwa file Excel ini adalah daftar keluarga CAWI yang usahanya memang wajib dinihilkan dari beban lapangan.
- **Opsi B WAJIB DITOLAK JIKA:**
  1. Ditemukan >10% sampel memiliki >1 usaha atau 0 usaha di FASIH.
  2. Ditemukan bahwa ketiadaan nama di Kolom R terjadi karena petugas lapangan belum melakukan verifikasi usaha CAWI tersebut.

---

## 7. USULAN REVISI IMPLEMENTATION PLAN (DRAFT DIFF)

*(Catatan: Usulan ini tidak menimpa `implementation_plan.md` sebelum disetujui)*

### A. Kebijakan Default Kolom R & Toggle Opsi B
- **Default:** Opsi A aktif secara permanen (`REQUIRE_NAMA_USAHA = true`). Setiap baris dengan Kolom R kosong langsung mengembalikan status `LEWATI (Kolom Nama Usaha di Excel Kosong)`.
- **Toggle Opsi B:** Disediakan opsi di toolbar ekstensi: `Izinkan Nihilasi Keluarga 1-Usaha Tanpa Nama Excel` (Default: `false` / MATI).
- **Pengaman Tambahan jika Opsi B Diaktifkan:**
  1. Status hasil mutasi ditandai khusus: `OK (Nihilasi 1-Usaha Tanpa Verifikasi Nama Excel)`.
  2. Dokumen di FASIH wajib memiliki **tepat 1 usaha non-pertanian**.
  3. Nama KK di dokumen FASIH wajib cocok dengan Kolom J di Excel.
  4. Kode SLS dan Nomor Bangunan wajib cocok 100%.

### B. Pembungkus `safeSet` Berassertion Skema Keras
Menggantikan pemanggilan `set()` langsung dengan wrapper yang memvalidasi skema:
```javascript
function safeSet(doc, schema, key, val) {
  // 1. Validasi keberadaan key di skema kuesioner resmi
  const base = key.replace(/#\d+$/, '');
  const f = schema.get(base);
  if (!f) {
    throw new Error(`ASSERTION GAGAL: dataKey "${key}" tidak terdaftar di skema resmi SE2026. Mutasi dibatalkan.`);
  }
  // 2. Validasi keberadaan key di dokumen answers
  const exists = doc.answers.some((a) => a.dataKey === key);
  if (!exists) {
    throw new Error(`ASSERTION GAGAL: dataKey "${key}" tidak ditemukan pada dokumen riil. Dilarang menambah key baru diam-diam.`);
  }
  // 3. Tulis jawaban secara aman
  setAnswer(doc, key, val);
}
```
- **Kasus Uji Offline (Test Cases):**
  - Uji 1: Memanggil `safeSet` pada `dataKey` yang sengaja salah ketik (harus melempar error dan membatalkan mutasi).
  - Uji 2: Memanggil `safeSet` pada key yang tidak ada di `answers` (harus menolak membuat key fiktif).
  - Uji 3: Memanggil `safeSet` dengan opsi tidak valid (harus melempar error).

### C. Circuit Breaker di Level Modul Script
- **Verifikasi Persistence State:** Telah diverifikasi dari `panel.js:491-537` bahwa modul script di-evaluasi sekali saat registrasi. Variabel state modul **bertahan antar baris** dalam satu sesi batch.
- **Arsitektur Circuit Breaker:**
  ```javascript
  let consecutiveErrors = 0;
  let circuitTripped = false;
  const skipStats = {};

  // Reset pada awal batch (via hook before)
  function before(rows, ctx) {
    consecutiveErrors = 0;
    circuitTripped = false;
    for (const k in skipStats) delete skipStats[k];
  }

  async function process(row, ctx) {
    if (circuitTripped) {
      return { skip: true, code: 'CIRCUIT_TRIPPED', ket: 'Circuit breaker aktif: Batch dihentikan otomatis karena error berturut-turut.' };
    }
    try {
      // Logika proses baris...
      consecutiveErrors = 0; // Reset jika sukses
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        circuitTripped = true;
        console.error('[CIRCUIT BREAKER] Terdeteksi 3 kegagalan berturut-turut. Menghentikan seluruh request jaringan berikutnya.');
      }
      throw err;
    }
  }
  ```
- **Keterbatasan:** Jika tab browser di-reload, state circuit breaker kembali ke nol. Circuit breaker tidak menghentikan loop runner secara paksa, melainkan me-`skip` seluruh baris berikutnya tanpa melakukan request jaringan apa pun.

### D. Eksekusi Batch Bertahap (Small Batch Execution)
- **Batch 1 (Pilot):** 1 SLS terkecil berisiko rendah, misal Desa Trayeman SLS `001500` (33 keluarga). Dilakukan Dry Run, disusul audit visual 100% pada UI FASIH.
- **Batch 2 (Validasi Lanjutan):** 3 SLS (total ~70–90 keluarga).
- **Batch 3 dst:** Kelompok maksimal 200 keluarga per sesi eksekusi, dengan jeda antar baris minimal 5.000 ms.

---

## 8. DAFTAR PERTANYAAN UNTUK PENGGUNA & SUPERVISOR BPS

Berikut adalah daftar pertanyaan bernomor yang wajib dijawab dan diputuskan sebelum penulisan script otomasi diizinkan:

1. **Arti Substantif Kolom R Kosong di Excel:**
   Apakah 1.887 baris keluarga Bangunan Campuran dengan Kolom R kosong di `Target Penyisiran Slawi.xlsx` memang dimaksudkan sebagai target penyesuaian CAWI? Siapa penyusun file Excel ini dan dari mana data tersebut ditarik (apakah dari prelist awal, monitoring CAWI, atau hasil penggabungan parsial)?
2. **Kebijakan Eksekusi untuk Kolom R Kosong:**
   Apakah Anda memilih **Opsi A (Ketat / Aman)** di mana 1.887 keluarga tersebut otomatis dilewati, ataukah ingin membuka opsi pengujian sampel untuk **Opsi B**?
3. **Kebenaran Aturan Penihilan Blok P:**
   Apakah aturan resmi BPS untuk keluarga yang sudah mengisi CAWI adalah **menihilkan seluruh jawaban usaha di kuesioner PCL** (Blok P = 2, Blok I = Tidak, hapus Blok II)? Ataukah kuesioner seharusnya tetap mencatat rincian usaha dengan tanda khusus CAWI?
4. **Otorisasi Akun dan Kewenangan Hukum:**
   Apakah akun FASIH yang digunakan login pada ekstensi memiliki wewenang resmi untuk mengubah data pencacahan keluarga milik mitra pencacah (PCL)?
5. **Status Lapangan dan Sinkronisasi Mobile PCL:**
   Apakah pencacahan lapangan di wilayah SLS target sudah 100% selesai dan seluruh petugas PCL sudah melakukan sinkronisasi akhir ke server? (Jika PCL masih aktif, sinkronisasi offline mobile mereka berisiko menimpa hasil batch).
6. **Ketersediaan Dokumen / Lingkungan Sandbox:**
   Apakah BPS menyediakan akun/server uji (*training/staging*) untuk SE2026, ataukah seluruh pengujian hanya bisa dilakukan langsung di server produksi?
7. **Jadwal Pelaksanaan Diagnostik T-01:**
   Kapan Anda dapat mengeksekusi script read-only `diagnostic_t01.js` pada konsol browser tab FASIH aktif dan membagikan JSON output-nya ke sini untuk memastikan nama `dataKey` riil?

---

### SELF-CHECK AUDITOR SEBELUM MENYERAHKAN
- [x] Sitasi kode diperiksa ulang dan seluruh kekeliruan L145 / FormGear dikoreksi dan ditandai `[KOREKSI SITASI]`.
- [x] Nilai SHA256 Excel asli sebelum dan sesudah riset terbukti identik (`4BF4CC211DFF...`).
- [x] Folder `evidence/` dan `scratch/` bersih dari data pribadi asli (0 NIK, 0 raw PII).
- [x] Profil terisi setiap kolom A..W untuk Bangunan Campuran dihitung faktual (1-baris vs multi-baris).
- [x] Angka 299 ditegaskan sebagai batas atas teoretis maksimal, bukan estimasi OK.
- [x] Protokol validasi empiris Dry Run dan UI Audit dirancang tanpa operasi tulis.
- [x] Tidak ada operasi tulis ke server FASIH dan tidak ada kode otomasi yang ditulis.
- [x] Menunggu persetujuan pengguna sebelum langkah berikutnya.
