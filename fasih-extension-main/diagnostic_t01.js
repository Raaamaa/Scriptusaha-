/* ============================================================================
 * DIAGNOSTIC HELPER T-01: Ekstraksi Skema & Struktur Kuesioner SE2026 (READ-ONLY)
 * ----------------------------------------------------------------------------
 * PERINGATAN KEAMANAN:
 * Script ini 100% READ-ONLY. SCRIPT INI TIDAK MEMODIFIKASI ATAU MENGUBAH DATA.
 * Dilarang keras memanggil FASIH.patch, FASIH.submitEdit, FASIH.restore, atau
 * mengirimkan request POST/PUT/DELETE apa pun ke server FASIH.
 *
 * CARA MENJALANKAN DI CHROME / EDGE:
 * 1. Buka tab https://fasih-sm.bps.go.id yang sudah login dan membuka salah satu
 *    dokumen Bangunan Campuran keluarga 1 usaha.
 * 2. Tekan F12 -> buka tab Console.
 * 3. Jika variabel MANUAL_ASSIGNMENT_ID di bawah ini diisi kosong (''), script otomatis
 *    mengambil ID assignment dari URL tab yang sedang dibuka.
 * 4. Salin seluruh isi file ini, tempel di Console, lalu tekan Enter.
 * 5. Hasil berupa satu objek JSON rapi akan otomatis tercetak dan disalin ke clipboard!
 * ==========================================================================*/

(async () => {
  // Ganti dengan ID tertentu jika ingin memeriksa assignment lain secara eksplisit,
  // atau biarkan kosong ('') untuk otomatis mengambil ID dari URL tab aktif.
  const MANUAL_ASSIGNMENT_ID = '';

  const urlMatch = location.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const id = MANUAL_ASSIGNMENT_ID.trim() || (urlMatch ? urlMatch[1] : '');

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    console.error('[DIAGNOSTIC ERROR] ID Assignment tidak valid atau tab bukan halaman assignment:', id);
    alert('Buka satu halaman assignment Bangunan Campuran di FASIH terlebih dahulu atau isi MANUAL_ASSIGNMENT_ID!');
    return;
  }

  console.log(`%c[DIAGNOSTIC T-01] Membaca skema & data dokumen (READ-ONLY): ${id}...`, 'color: #188038; font-weight: bold;');

  // 1. Inisialisasi skema template (READ-ONLY: hanya membaca metadata dan struktur template FormGear)
  let schemaMap;
  try {
    schemaMap = await FASIH.init({ assignmentId: id });
  } catch (err) {
    console.error('[DIAGNOSTIC ERROR] Gagal inisialisasi skema:', err);
    return;
  }

  // 2. Ambil dokumen dari server (READ-ONLY: GET request via FASIH.getAssignment)
  const asg = await FASIH.getAssignment(id);
  if (!asg || !asg.data) {
    console.error('[DIAGNOSTIC ERROR] Gagal mengambil data dokumen dari server.');
    return;
  }

  let doc;
  try {
    doc = JSON.parse(asg.data);
  } catch (err) {
    console.error('[DIAGNOSTIC ERROR] Gagal parse JSON asg.data:', err);
    return;
  }

  const answers = doc.answers || [];
  const cari = (k) => (answers.find((a) => a.dataKey === k) || {}).answer;
  const value0 = (v) => {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v) && v[0]) return v[0].value != null ? String(v[0].value) : String(v[0]);
    if (typeof v === 'object' && v.value != null) return String(v.value);
    return String(v);
  };
  const label0 = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v) && v[0] && v[0].label != null) return String(v[0].label);
    if (typeof v === 'object' && v.label != null) return String(v.label);
    return String(v);
  };

  // Masking fungsi untuk privasi (nama disamarkan: "Budi Santoso" -> "B*** S***")
  const maskText = (str) => {
    if (!str) return '';
    return String(str)
      .split(' ')
      .map((w) => (w.length > 1 ? w[0] + '*'.repeat(Math.min(w.length - 1, 4)) : w))
      .join(' ');
  };

  const discrepancies = [];

  // -------------------------------------------------------------
  // A. Identifikasi Field Blok P (Pertanyaan Penapis Usaha)
  // -------------------------------------------------------------
  const blokPFields = [];
  const candidateRadioQuestions = [];

  for (const [key, s] of schemaMap.entries()) {
    const sec = (s.section || '').toLowerCase();
    const lbl = (s.label || '').toLowerCase();

    const isSecP = sec.includes('se2026 - p') || sec.includes('se2026-p') || sec.includes('blok p') ||
      sec.includes('penapis') || (sec.includes('keluarga') && sec.includes('bangunan'));
    const isUsaha = lbl.includes('memiliki usaha') || lbl.includes('mengelola usaha pertanian') || lbl.includes('kontrakan atau kos') ||
      lbl.includes('apakah ada usaha') || lbl.includes('kegiatan usaha');

    const hasRadioYaTidak = (s.options || []).some((o) => String(o.value) === '1') &&
                            (s.options || []).some((o) => String(o.value) === '2');

    // Catat semua kandidat radio Ya/Tidak tanpa indeks roster untuk audit lengkap
    if (hasRadioYaTidak && !/#\d+/.test(key)) {
      candidateRadioQuestions.push({
        dataKey: key,
        label: s.label,
        section: s.section,
        tipe: s.kind || s.type,
        options: (s.options || []).map((o) => ({ value: o.value, label: o.label })),
      });
    }

    // Filter khusus Blok P
    if ((isSecP || isUsaha) && hasRadioYaTidak && !/#\d+/.test(key)) {
      const ansObj = answers.find((a) => a.dataKey === key);
      blokPFields.push({
        dataKey: key,
        label: s.label,
        tipe: s.kind || s.type,
        section: s.section,
        options: (s.options || []).map((o) => ({ value: o.value, label: o.label })),
        nilaiDiDokumen: ansObj ? { value: value0(ansObj.answer), label: label0(ansObj.answer) } : null,
      });
    }
  }

  if (blokPFields.length !== 13) {
    discrepancies.push(`Jumlah field penapis Blok P terdeteksi ${blokPFields.length} (asumsi plan: tepat 13 field).`);
  }

  // -------------------------------------------------------------
  // B. Identifikasi Field Blok I per ART (Pola #n)
  // -------------------------------------------------------------
  const blokIArtFields = [];
  const blokIBaseKeys = new Set();

  for (const a of answers) {
    const m = a.dataKey.match(/^([a-z0-9_]+)#(\d+)$/i);
    if (!m) continue;
    const [_, baseK, idx] = m;
    const s = schemaMap.get(baseK);
    const sec = (s ? s.section : '').toLowerCase();
    const lbl = (s ? s.label : '').toLowerCase();

    const isBlokI = sec.includes('blok i') || sec.includes('anggota') || sec.includes('art') ||
      baseK.includes('art') || baseK.includes('dtsen') || baseK.startsWith('b1_');

    if (isBlokI) {
      blokIBaseKeys.add(baseK);
    }

    // Deteksi pertanyaan usaha per ART (apakah memiliki usaha / ada usaha)
    const isArtUsahaQ = lbl.includes('memiliki usaha') || lbl.includes('kegiatan usaha') ||
      baseK.includes('usaha') || baseK === 'ada_usaha' || baseK === 'art_pengusaha';

    if (isArtUsahaQ) {
      const namaArt = cari(`nama_dtsen#${idx}`) || cari(`nama_art#${idx}`) || cari(`nama_anggota#${idx}`) || `ART #${idx}`;
      blokIArtFields.push({
        dataKey: a.dataKey,
        artIndex: idx,
        artNamaMasked: maskText(namaArt),
        label: s ? s.label : '',
        section: s ? s.section : '',
        options: s ? (s.options || []).map((o) => ({ value: o.value, label: o.label })) : [],
        nilaiDiDokumen: { value: value0(a.answer), label: label0(a.answer) },
      });
    }
  }

  // -------------------------------------------------------------
  // C. Identifikasi Field Roster Blok II (Usaha)
  // -------------------------------------------------------------
  const blokIIRosterMap = new Map();
  const sampleUsahaAnswers = [];
  let sampleIndex = null;

  for (const a of answers) {
    const m = a.dataKey.match(/^([a-z0-9_]+)#(\d+)(?:#(\d+))?$/i);
    if (!m) continue;
    const [_, baseK, idx1, idx2] = m;
    const s = schemaMap.get(baseK);
    const sec = (s ? s.section : '').toLowerCase();
    const lbl = (s ? s.label : '').toLowerCase();

    const isBlokII = sec.includes('blok ii') || sec.includes('keterangan usaha') || sec.includes('rincian usaha') ||
      ['nama_usaha', 'nama_komersial', 'keberadaan_usaha', 'kbli', 'nilai_pendapatan', 'total_pengeluaran', 'omset'].includes(baseK) ||
      baseK.startsWith('b2_');

    if (isBlokII) {
      if (!blokIIRosterMap.has(idx1)) {
        blokIIRosterMap.set(idx1, {
          index: idx1,
          fields: [],
        });
      }
      blokIIRosterMap.get(idx1).fields.push({
        fullKey: a.dataKey,
        baseKey: baseK,
        label: s ? s.label : '',
        nestedIndex: idx2 || null,
        tipe: s ? (s.kind || s.type) : 'unknown',
      });

      if (!sampleIndex) sampleIndex = idx1;
      if (idx1 === sampleIndex) {
        let maskedVal = a.answer;
        if (typeof a.answer === 'string') {
          maskedVal = maskText(a.answer);
        } else if (Array.isArray(a.answer) && a.answer[0] && typeof a.answer[0].label === 'string') {
          maskedVal = [{ value: a.answer[0].value, label: a.answer[0].label }];
        }
        sampleUsahaAnswers.push({
          dataKey: a.dataKey,
          baseKey: baseK,
          nilaiMasked: maskedVal,
        });
      }
    }
  }

  const nRosterUsaha = blokIIRosterMap.size;
  if (nRosterUsaha !== 1) {
    discrepancies.push(`Dokumen yang diperiksa memiliki ${nRosterUsaha} unit usaha di Blok II (asumsi sampel: tepat 1 usaha).`);
  }

  // -------------------------------------------------------------
  // D. Nilai Aktual Dokumen & Status Whitelist
  // -------------------------------------------------------------
  const kodeBangVal = value0(cari('kode_bang'));
  if (kodeBangVal !== '2') {
    discrepancies.push(`kode_bang bernilai "${kodeBangVal}" (asumsi plan: harus '2' untuk Bangunan Campuran).`);
  }

  // Cari key nama KK di dokumen
  let namaKkKey = null;
  let namaKkVal = null;
  for (const k of ['nama_kk', 'dtsen_nama_kk', 'nama_krt', 'sls_nama_kk', 'nama_kepala_keluarga']) {
    const val = cari(k);
    if (val) {
      namaKkKey = k;
      namaKkVal = val;
      break;
    }
  }

  // Jika belum ketemu dari daftar nama di atas, cari dari skema label
  if (!namaKkKey) {
    for (const a of answers) {
      const s = schemaMap.get(a.dataKey);
      const lbl = (s ? s.label : '').toLowerCase();
      if ((lbl.includes('kepala keluarga') || lbl.includes('kepala rumah tangga')) && typeof a.answer === 'string') {
        namaKkKey = a.dataKey;
        namaKkVal = a.answer;
        break;
      }
    }
  }

  const documentStatus = {
    assignment_status_alias: asg.assignment_status_alias,
    assignment_status: asg.assignment_status,
    status: asg.status,
    validation_status: asg.validation_status,
    submit_version_code: asg.submit_version_code,
    progress: asg.progress,
    is_submitted: asg.is_submitted,
    is_active: asg.is_active,
  };

  // -------------------------------------------------------------
  // E. Keberadaan & Nilai Metadata Turunan FormGear
  // -------------------------------------------------------------
  const metadataKeys = [
    'jumlah_usaha',
    'jumlah_usaha_ditemukan',
    'ec_ada_usaha',
    'label_usaha',
    'art_pengusaha',
  ];

  const metadataInspection = {};
  for (const mk of metadataKeys) {
    const s = schemaMap.get(mk);
    const ans = cari(mk);
    metadataInspection[mk] = {
      adaDiDokumen: ans !== undefined,
      nilaiDiDokumen: ans !== undefined ? (typeof ans === 'object' ? JSON.stringify(ans) : ans) : '(tidak ada)',
      adaDiSkema: s !== undefined && s !== null,
      tipeSkema: s ? (s.kind || s.type) : '(tidak ada di skema)',
    };
  }

  metadataInspection['doc.isForceSubmit'] = {
    adaDiDokumen: 'isForceSubmit' in doc,
    nilaiDiDokumen: doc.isForceSubmit,
    adaDiSkema: false,
    tipeSkema: 'root-property',
  };

  // -------------------------------------------------------------
  // OUTPUT BUNDLE (SATU OBJEK JSON RAPI)
  // -------------------------------------------------------------
  const outputResult = {
    diagnostic_version: '1.1.0-READONLY',
    timestamp: new Date().toISOString(),
    assignment_id: id,
    code_identity: asg.code_identity,
    kesimpulan_discrepancies: discrepancies.length ? discrepancies : 'SEMUA ASUMSI AWAL PLAN SESUAI!',
    ringkasan: {
      jumlah_field_blok_p: blokPFields.length,
      jumlah_art_blok_i_pertanyaan_usaha: blokIArtFields.length,
      jumlah_usaha_roster_blok_ii: nRosterUsaha,
      kode_bang: kodeBangVal,
      nama_kk_key: namaKkKey,
      status_dokumen_asli: asg.assignment_status_alias,
    },
    a_blok_p_fields: {
      total_terdeteksi: blokPFields.length,
      apakah_tepat_13: blokPFields.length === 13,
      fields: blokPFields,
      kandidat_ya_tidak_lainnya_jika_bukan_13: blokPFields.length !== 13 ? candidateRadioQuestions : undefined,
    },
    b_blok_i_art_fields: {
      pertanyaan_usaha_per_art: blokIArtFields,
      daftar_basekey_roster_art: [...blokIBaseKeys],
    },
    c_blok_ii_roster: {
      jumlah_usaha: nRosterUsaha,
      daftar_index_usaha: [...blokIIRosterMap.keys()],
      daftar_base_keys_blok_ii: [...new Set([...blokIIRosterMap.values()].flatMap((u) => u.fields.map((f) => f.baseKey)))],
      apakah_ada_indeks_bersarang: [...blokIIRosterMap.values()].some((u) => u.fields.some((f) => f.nestedIndex !== null)),
      struktur_fields_per_usaha: [...blokIIRosterMap.values()].map((u) => ({
        index: u.index,
        jumlah_field: u.fields.length,
        baseKeys: u.fields.map((f) => f.baseKey),
      })),
    },
    d_nilai_aktual_dokumen: {
      kode_bang: { value: kodeBangVal, label: label0(cari('kode_bang')) },
      nama_kk: { dataKey: namaKkKey, nilaiMasked: maskText(namaKkVal) },
      status_lengkap_dokumen: documentStatus,
    },
    e_metadata_inspection: metadataInspection,
    f_sample_answers_satu_usaha: sampleUsahaAnswers,
  };

  const jsonString = JSON.stringify(outputResult, null, 2);

  // Otomatis salin ke clipboard jika diizinkan browser
  try {
    await navigator.clipboard.writeText(jsonString);
    console.log('%c[SUKSES] Hasil JSON telah otomatis disalin ke clipboard!', 'color: #188038; font-weight: bold;');
  } catch (e) {
    console.log('[INFO] Otomatis copy dicegah browser. Salin objek dari console secara manual.');
  }

  console.log(outputResult);
  return outputResult;
})();
