/* ============================================================================
 * batch-automation - keuangan usaha (tahunan + bulanan).js — Import script
 * ----------------------------------------------------------------------------
 * KASUS: koreksi nilai keuangan usaha pada satu baris usaha (#index1).
 *
 * Field TAHUNAN (sama polanya dengan "update keuangan usaha prelist keluarga.js"):
 *   gaji, biaya_produksi, biaya_pembelian, operasional, non_operasional
 *     -> total_pengeluaran   = jumlah kelimanya
 *   nilai_pendapatan, pendapatan_lain
 *     -> total_pendapatan    = jumlah keduanya
 *
 * Field BULANAN (*_bln):
 *   gaji_bln, biaya_produksi_bln, biaya_pembelian_bln, operasional_bln,
 *   non_operasional_bln   -> total_pengeluaran_bln
 *   nilai_pendapatan_bln, pendapatan_lain_bln -> total_pendapatan_bln
 *   tahun_operasi HANYA dibaca dari record (tidak ada kolomnya di sheet).
 *
 * ATURAN TAHUN (tahun_operasi#index1 di record):
 *   tahun_operasi == 2026  -> HANYA kolom *_bln yang boleh diisi.
 *   tahun_operasi <  2026  -> HANYA kolom non-bln (tahunan) yang boleh diisi.
 *   Selain itu (>= 2026 tapi bukan 2026, atau kosong) -> keduanya tidak boleh.
 *   Kalau kolom ATAU remark dari grup yang tidak diizinkan terisi, baris GAGAL:
 *   "[<tahun_operasi>] tidak bisa edit data karena kolom dan tahun operasi tidak sinkron".
 *
 * DataKey ditulis sebagai <field>#index1 (mis. pendapatan_lain#1001).
 * Total dihitung ulang otomatis (tidak ada kolom total di sheet).
 * info_pengeluaran_bln tidak disentuh.
 *
 * Kolom sheet (semua opsional kecuali assignment_id & index1):
 *   assignment_id | index1
 *   | gaji | biaya_produksi | biaya_pembelian | operasional | non_operasional
 *   | nilai_pendapatan | pendapatan_lain
 *   | gaji_bln | biaya_produksi_bln | biaya_pembelian_bln | operasional_bln | non_operasional_bln
 *   | nilai_pendapatan_bln | pendapatan_lain_bln
 *   Sel kosong = nilai lama dipertahankan. Semua kolom sama dengan record -> LEWATI.
 *   Angka tanpa pemisah ribuan (2961702, bukan 2.961.702).
 *
 * Remark (toggle "Remark" di toolbar): satu kolom remark_<field> untuk tiap kolom nilai
 *   (remark_gaji, remark_biaya_produksi, ..., remark_*_bln) — ditambahkan panel setelah
 *   kolom terakhir. Sel terisi ditulis sebagai catatan di <field>#index1, satu submit per
 *   remark. Tidak ada data yang diubah tapi ada remark -> hanya remark yang ditulis.
 *   Remark ikut aturan tahun (grup yang tidak diizinkan -> baris GAGAL, remark tidak ditulis).
 * ==========================================================================*/

const KOMP_PENGELUARAN     = ['gaji', 'biaya_produksi', 'biaya_pembelian', 'operasional', 'non_operasional'];
const KOMP_PENDAPATAN      = ['nilai_pendapatan', 'pendapatan_lain'];
const KOMP_PENGELUARAN_BLN = KOMP_PENGELUARAN.map((k) => `${k}_bln`);
const KOMP_PENDAPATAN_BLN  = KOMP_PENDAPATAN.map((k) => `${k}_bln`);
const KOLOM_BLN            = [...KOMP_PENGELUARAN_BLN, ...KOMP_PENDAPATAN_BLN];
const KOLOM_NILAI          = [...KOMP_PENGELUARAN, ...KOMP_PENDAPATAN, ...KOLOM_BLN];
const KODE_FIELD           = 'tahun_operasi';
const TAHUN_BLN            = 2026;                 // tahun yang mengaktifkan kolom *_bln
const JUMLAH_FIELD         = [...KOLOM_NILAI, KODE_FIELD];   // untuk cek baris ada

const teks = (v) => (v == null ? '' : String(v).trim());
const versi = (r, dryRun) => (dryRun ? `v${r.version}` : `v${r.version} → v${r.versionAfter}`);

function nilaiDariSheet(row) {
  return Object.fromEntries(KOLOM_NILAI.filter((k) => row[k] != null).map((k) => [k, row[k]]));
}

async function prosesSatu(row, { dryRun, remarks = [] }) {
  const n = row.index1;
  /* remark ditulis panel ke baris usaha ini: <field> -> <field>#index1 */
  const remarkKeys = Object.fromEntries(KOLOM_NILAI.map((k) => [k, `${k}#${n}`]));
  const asg = await FASIH.getAssignment(row.assignment_id);
  if (!asg || !asg.data) throw new Error('assignment tidak ditemukan / belum ada isian');
  const answers = JSON.parse(asg.data).answers;
  const cari = (k) => (answers.find((a) => a.dataKey === k) || {}).answer;

  if (!JUMLAH_FIELD.some((k) => answers.some((a) => a.dataKey === `${k}#${n}`)))
    throw new Error(`baris usaha #${n} tidak ada di record — cek index1 (mis. FASIH.rows(assignment_id, 'pendapatan_lain'))`);

  const tahunRaw = teks(cari(`tahun_operasi#${n}`));
  const tahun = tahunRaw === '' ? NaN : Number(tahunRaw);
  const tag = `[${Number.isFinite(tahun) ? tahun : '-'}]`;             // tahun_operasi di depan keterangan
  const blnAktif = tahun === TAHUN_BLN;                                 // == 2026 -> *_bln
  const nonblnAktif = Number.isFinite(tahun) && tahun < TAHUN_BLN;      // < 2026 -> non-bln

  const semua = nilaiDariSheet(row);                                   // { field: nilai } dari sheet
  const adaBln = Object.keys(semua).some((k) => KOLOM_BLN.includes(k));
  const adaNonBln = Object.keys(semua).some((k) => !KOLOM_BLN.includes(k));
  const remarkBln = remarks.some((r) => KOLOM_BLN.includes(r.dataKey));
  const remarkNonBln = remarks.some((r) => !KOLOM_BLN.includes(r.dataKey));

  /* *_bln hanya boleh saat tahun_operasi = 2026; non-bln hanya saat < 2026 -> selain itu GAGAL */
  if (((adaBln || remarkBln) && !blnAktif) || ((adaNonBln || remarkNonBln) && !nonblnAktif))
    throw new Error(`${tag} tidak bisa edit data karena kolom dan tahun operasi tidak sinkron`);

  const nilai = semua;
  const beda = (k) => Number(cari(`${k}#${n}`)) !== Number(nilai[k]) || cari(`${k}#${n}`) == null;
  const berubah = Object.keys(nilai).filter(beda);
  const blnBerubah = berubah.filter((k) => KOLOM_BLN.includes(k));

  if (!berubah.length) {
    const ket = `${tag} #${n}: ${Object.keys(nilai).length ? 'nilai sudah sesuai' : 'kolom nilai kosong'}` +
                (remarks.length ? ' — data tidak diubah, hanya remark' : '');
    return remarks.length ? { code: asg.code_identity, ket, remarkKeys } : { skip: true, code: asg.code_identity, ket };
  }

  const ambil = (k) => (k in nilai ? nilai[k] : Number(cari(`${k}#${n}`)) || 0);
  const jumlah = (list) => list.reduce((s, k) => s + ambil(k), 0);

  const V = {};
  for (const [k, v] of Object.entries(nilai)) V[`${k}#${n}`] = v;
  if (berubah.some((k) => KOMP_PENGELUARAN.includes(k))) V[`total_pengeluaran#${n}`] = jumlah(KOMP_PENGELUARAN);
  if (berubah.some((k) => KOMP_PENDAPATAN.includes(k)))  V[`total_pendapatan#${n}`]  = jumlah(KOMP_PENDAPATAN);
  if (blnBerubah.length) {
    V[`total_pengeluaran_bln#${n}`] = jumlah(KOMP_PENGELUARAN_BLN);
    V[`total_pendapatan_bln#${n}`]  = jumlah(KOMP_PENDAPATAN_BLN);
  }

  const rp = (v) => (v == null ? '-' : Number(v).toLocaleString('id-ID'));
  const r = await FASIH.patch(row.assignment_id, (doc, { set }) => {
    for (const [k, v] of Object.entries(V)) set(k, v);
  }, { dryRun, log: false });

  const ubah = berubah.map((k) => `${k} ${rp(cari(`${k}#${n}`))} → ${rp(nilai[k])}`);
  return { code: r.code, ket: [
    `${tag} #${n}`,
    ...ubah,
    ...(berubah.some((k) => KOMP_PENGELUARAN.includes(k))
      ? [`pengeluaran ${rp(cari(`total_pengeluaran#${n}`))} → ${rp(V[`total_pengeluaran#${n}`])}`] : []),
    ...(berubah.some((k) => KOMP_PENDAPATAN.includes(k))
      ? [`pendapatan ${rp(cari(`total_pendapatan#${n}`))} → ${rp(V[`total_pendapatan#${n}`])}`] : []),
    ...(blnBerubah.length
      ? [`bln: pengeluaran → ${rp(V[`total_pengeluaran_bln#${n}`])}, pendapatan → ${rp(V[`total_pendapatan_bln#${n}`])}`] : []),
    `${r.nChanges} perubahan`, versi(r, dryRun),
  ].filter(Boolean).join(' · '), remarkKeys };
}

FASIH_BATCH.register({
  id: 'koreksi-pendapatan-lain',
  name: 'Koreksi Keuangan Usaha (tahunan & bulanan)',
  description: 'Ganti komponen keuangan usaha #index1; total dihitung ulang; kolom *_bln hanya bila tahun_operasi (record) = 2026',
  columns: [
    { key: 'assignment_id', type: 'uuid', required: true, unique: true },
    { key: 'index1',        title: 'index1', type: 'integer', required: true, width: 80 },
    { key: 'gaji',             title: 'gaji (opsional)', type: 'integer' },
    { key: 'biaya_produksi',   title: 'biaya_produksi (opsional)', type: 'integer' },
    { key: 'biaya_pembelian',  title: 'biaya_pembelian (opsional)', type: 'integer' },
    { key: 'operasional',      title: 'operasional (opsional)', type: 'integer' },
    { key: 'non_operasional',  title: 'non_operasional (opsional)', type: 'integer' },
    { key: 'nilai_pendapatan', title: 'nilai_pendapatan (opsional)', type: 'integer' },
    { key: 'pendapatan_lain',  title: 'pendapatan_lain (opsional)', type: 'integer' },
    { key: 'gaji_bln',             title: 'gaji_bln (opsional, 2026)', type: 'integer' },
    { key: 'biaya_produksi_bln',   title: 'biaya_produksi_bln (opsional, 2026)', type: 'integer' },
    { key: 'biaya_pembelian_bln',  title: 'biaya_pembelian_bln (opsional, 2026)', type: 'integer' },
    { key: 'operasional_bln',      title: 'operasional_bln (opsional, 2026)', type: 'integer' },
    { key: 'non_operasional_bln',  title: 'non_operasional_bln (opsional, 2026)', type: 'integer' },
    { key: 'nilai_pendapatan_bln', title: 'nilai_pendapatan_bln (opsional, 2026)', type: 'integer' },
    { key: 'pendapatan_lain_bln',  title: 'pendapatan_lain_bln (opsional, 2026)', type: 'integer' },
  ],
  idColumn: 'assignment_id',
  /* Catatan per-pertanyaan — muncul saat toggle Remark aktif; ditulis ke <field>#index1
     baris usaha yang cocok (lewat remarkKeys dari process) */
  remarks: KOLOM_NILAI.map((k) => ({ dataKey: k, title: `remark ${k}` })),
  validateRow: (row) => {
    const e = {};
    if (row.index1 != null && row.index1 < 1) e.index1 = 'minimal 1';
    for (const k of KOLOM_NILAI) if (row[k] != null && row[k] < 0) e[k] = 'tidak boleh negatif';
    return Object.keys(e).length ? e : null;
  },

  async process(row, { dryRun, remarks }) {
    return prosesSatu(row, { dryRun, remarks });
  },
});
