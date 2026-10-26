/* ============================================================================
 * batch-automation - penyesuaian usaha cawi.js
 * Ekstensi FASIH Batch — Otomasi Penyesuaian Usaha CAWI (Keluarga SE2026)
 * ============================================================================
 * KASUS:
 * Menihilkan usaha keluarga SE2026 (Bangunan Campuran) yang telah tercatat via
 * CAWI, agar beban pencacahan lapangan tidak ganda.
 *
 * PRINSIP KEAMANAN DATA:
 * 1. Read-first & Assertion ketat: Dokumen FASIH adalah acuan kebenaran tunggal.
 * 2. safeSet: Jika skema punya options, SELALU pakai jalur opsi [{...opt, open:false}]
 *    tanpa melihat nilai type; untuk field tanpa options, pertahankan tipe nilai yang
 *    sudah ada di dokumen (number tetap number, boolean tetap boolean, string tetap string,
 *    array tetap array) dan lempar error jika tipe nilai baru tidak cocok. Dilarang menambah
 *    key baru secara diam-diam.
 * 3. Roster Blok II: Dihapus SEMUA key di SECTION_BLOK_II berindeks usaha tunggal (#n)
 *    dengan splice di tempat. Key section lain & ART berindeks sama (mis. nama_art#1) tetap utuh.
 *    Jika sebelum hapus ada key bersarang (#n#) di Blok II -> LEWATI.
 *    Jika setelah splice di tempat masih ada key Blok II usaha itu -> lempar error.
 * 4. Zero multi-usaha mutation: Keluarga dengan >= 2 usaha DILARANG KERAS dimutasi.
 * 5. Circuit breaker: Reset counter pada SETIAP return tanpa error (OK dan LEWATI).
 *    Saat breaker aktif, langsung LEMPAR error (bukan skip).
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * KONSTANTA DATAKEYS & AUTO-DISCOVERY SKEMA
 * Script secara otomatis mendeteksi field kuesioner SE2026 langsung dari
 * FASIH.schema saat pertama kali dijalankan, tanpa perlu diisi manual.
 * --------------------------------------------------------------------------*/
const DATAKEYS = {
  // 1. Whitelist status assignment yang diizinkan untuk diedit
  WHITELIST_STATUS: [
    'ASSIGNED',
    'IN_PROGRESS',
    'REVISE',
    'REVISION',
    'NOT_SUBMITTED',
    'OPEN',
    'PENDING',
    'SUBMITTED',
    'APPROVED'
  ],

  // 2. Key penanda penggunaan bangunan (nilai '2' = Bangunan Campuran)
  KODE_BANG: 'kode_bang',

  // 3. Key nama Kepala Keluarga di dokumen FASIH (otomatis mendeteksi nama_kk / dtsen_nama_kk)
  NAMA_KK: 'nama_kk',

  // 4. 13 Field Blok P (Otomatis dideteksi dari template SE2026)
  BLOK_P_PERTANIAN: [],
  BLOK_P_NON_PERTANIAN: [],

  // 5. BaseKey pertanyaan kepemilikan usaha ART di Blok I (otomatis dideteksi)
  BLOK_I_ART_USAHA: 'art_usaha',

  // 6. Nama Section Blok II di Skema Template FASIH
  // Default SE2026: 'SE2026 - L BLOK II' atau 'BLOK II' (otomatis terdeteksi)
  SECTION_BLOK_II: 'SE2026 - L BLOK II',

  // 7. Daftar nama field pencocokan nama usaha di roster Blok II
  FIELD_NAMA_USAHA: ['nama_usaha', 'nama_usaha_edit', 'nama_komersial'],

  // 8. Field ringkasan agregat usaha di level keluarga (hanya diubah jika key sudah ada di dokumen)
  SUMMARY_FIELDS: {
    jumlah_usaha: 'jumlah_usaha',
    jumlah_usaha_ditemukan: 'jumlah_usaha_ditemukan',
    ec_ada_usaha: 'ec_ada_usaha',
    label_usaha: 'label_usaha',
    art_pengusaha: 'art_pengusaha',
  },
};

/* ----------------------------------------------------------------------------
 * HELPER NORMALISASI & STATE CIRCUIT BREAKER
 * --------------------------------------------------------------------------*/

function norm(str) {
  if (str == null) return '';
  return String(str)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVal(ans) {
  if (ans == null) return null;
  if (Array.isArray(ans)) {
    if (ans.length === 0) return null;
    if (typeof ans[0] === 'object' && ans[0] !== null && 'value' in ans[0]) {
      return String(ans[0].value).trim();
    }
    return String(ans[0]).trim();
  }
  if (typeof ans === 'object' && ans !== null && 'value' in ans) {
    return String(ans.value).trim();
  }
  return String(ans).trim();
}

function getAnswer(answers, dataKey) {
  const row = answers.find((a) => a.dataKey === dataKey);
  return row ? row.answer : undefined;
}

function getOptionByValue(schemaItem, valString) {
  if (!schemaItem || !schemaItem.options) return null;
  const want = String(valString).trim().toLowerCase();
  return schemaItem.options.find((o) =>
    String(o.value).trim().toLowerCase() === want ||
    String(o.label).trim().toLowerCase() === want
  );
}

function isOptionMatch(schemaItem, ans, targetVal) {
  const opt = getOptionByValue(schemaItem, targetVal);
  if (!opt) return false;
  const currentVal = getVal(ans);
  return currentVal === String(opt.value).trim();
}

let CACHED_RESOLVED_KEYS = null;

function resetResolvedKeysCache() {
  CACHED_RESOLVED_KEYS = null;
}

function hasTodo(val) {
  if (val == null) return false;
  if (Array.isArray(val)) return val.length === 0 || val.some(hasTodo);
  return String(val).includes('TODO_VERIFY');
}

/**
 * Auto-Discovery Metadata Skema Kuesioner SE2026.
 * Mendeteksi Section Blok II, 13 Field Blok P (7 Pertanian + 6 Non-Pertanian),
 * pertanyaan ART Blok I, dan nama_kk langsung dari FASIH.schema secara otomatis.
 */
function resolveSchemaMetadata(F, answers, injectedKeys = null) {
  // 1. Jika injectedKeys disediakan tanpa TODO_VERIFY dan lengkap, gunakan langsung (mis. unit test)
  if (
    injectedKeys &&
    !hasTodo(injectedKeys.SECTION_BLOK_II) &&
    Array.isArray(injectedKeys.BLOK_P_PERTANIAN) &&
    injectedKeys.BLOK_P_PERTANIAN.length === 7 &&
    !hasTodo(injectedKeys.BLOK_P_PERTANIAN) &&
    Array.isArray(injectedKeys.BLOK_P_NON_PERTANIAN) &&
    injectedKeys.BLOK_P_NON_PERTANIAN.length === 6 &&
    !hasTodo(injectedKeys.BLOK_P_NON_PERTANIAN) &&
    !hasTodo(injectedKeys.BLOK_I_ART_USAHA) &&
    !hasTodo(injectedKeys.NAMA_KK)
  ) {
    return injectedKeys;
  }

  // 2. Kembalikan dari cache jika sudah pernah di-resolve sebelumnya
  if (CACHED_RESOLVED_KEYS) {
    return CACHED_RESOLVED_KEYS;
  }

  const baseKeysInAnswers = [...new Set((answers || []).map((a) => String(a.dataKey).replace(/#\d+.*$/, '')))];

  // Kumpulkan koleksi schema items
  let schemaMap = null;
  if (F && F._internal && F._internal.SCHEMA instanceof Map) {
    schemaMap = F._internal.SCHEMA;
  } else if (F && F.schemaMap instanceof Map) {
    schemaMap = F.schemaMap;
  } else if (F && typeof F.schema === 'function') {
    schemaMap = new Map();
    for (const bk of baseKeysInAnswers) {
      const s = F.schema(bk);
      if (s) schemaMap.set(bk, s);
    }
  }

  const allSchemaItems = [];
  if (schemaMap) {
    for (const [k, v] of schemaMap.entries()) {
      if (v) {
        allSchemaItems.push({ dataKey: v.dataKey || k, ...v });
      }
    }
  }

  // A. SECTION_BLOK_II
  let sectionBlokII = null;
  const fieldUsahaCandidates = DATAKEYS.FIELD_NAMA_USAHA || ['nama_usaha', 'nama_usaha_edit', 'nama_komersial'];
  for (const cand of fieldUsahaCandidates) {
    const s = F && F.schema ? F.schema(cand) : (schemaMap ? schemaMap.get(cand) : null);
    if (s && s.section) {
      sectionBlokII = s.section;
      break;
    }
  }
  if (!sectionBlokII) {
    const itemBlokII = allSchemaItems.find((s) => {
      const sec = String(s.section || '').toLowerCase();
      return sec.includes('blok ii') || sec.includes('keterangan usaha');
    });
    if (itemBlokII && itemBlokII.section) {
      sectionBlokII = itemBlokII.section;
    }
  }
  if (!sectionBlokII) {
    sectionBlokII = DATAKEYS.SECTION_BLOK_II || 'SE2026 - L BLOK II';
  }

  // B. 13 Field Blok P (7 Pertanian + 6 Non-Pertanian)
  let blokPPertanian = [];
  let blokPNonPertanian = [];

  // Cari field Blok P: radio Ya/Tidak non-roster
  const blokPItems = [];
  for (const item of allSchemaItems) {
    const sec = String(item.section || '').toLowerCase();
    const isSecP = sec.includes('se2026 - p') || sec.includes('se2026-p') || sec.includes('blok p') ||
      sec.includes('penapis') || (sec.includes('keluarga') && sec.includes('bangunan'));
    const isRadio = Array.isArray(item.options) &&
      item.options.some((o) => String(o.value) === '1') &&
      item.options.some((o) => String(o.value) === '2');
    const isNotRoster = !String(item.dataKey).includes('#');

    if (isSecP && isRadio && isNotRoster) {
      blokPItems.push(item);
    }
  }

  // Fallback jika tidak menemukan dari section 'BLOK P', periksa kandidat radio Ya/Tidak non-roster
  if (blokPItems.length !== 13) {
    const allRadioNonRoster = allSchemaItems.filter((item) => {
      const isRadio = Array.isArray(item.options) &&
        item.options.some((o) => String(o.value) === '1') &&
        item.options.some((o) => String(o.value) === '2');
      const isNotRoster = !String(item.dataKey).includes('#');
      const dk = String(item.dataKey).toLowerCase();
      return isRadio && isNotRoster && dk !== 'kode_bang';
    });

    if (allRadioNonRoster.length === 13) {
      blokPItems.length = 0;
      blokPItems.push(...allRadioNonRoster);
    }
  }

  if (blokPItems.length === 13) {
    const isAgri = (item) => {
      const txt = `${item.label || ''} ${item.dataKey || ''}`.toLowerCase();
      return /pertanian|tanaman|hortikultura|perkebunan|kebun|peternakan|ternak|kehutanan|hutan|perikanan|ikan|agri/i.test(txt);
    };

    const agriItems = blokPItems.filter(isAgri);
    const nonAgriItems = blokPItems.filter((i) => !isAgri(i));

    if (agriItems.length === 7 && nonAgriItems.length === 6) {
      blokPPertanian = agriItems.map((i) => i.dataKey);
      blokPNonPertanian = nonAgriItems.map((i) => i.dataKey);
    } else {
      // Fallback urutan standar SE2026: 7 pertanyaan pertama pertanian, 6 berikutnya non-pertanian
      blokPPertanian = blokPItems.slice(0, 7).map((i) => i.dataKey);
      blokPNonPertanian = blokPItems.slice(7, 13).map((i) => i.dataKey);
    }
  }

  // C. BLOK_I_ART_USAHA
  let blokIArtUsaha = null;
  for (const item of allSchemaItems) {
    const sec = String(item.section || '').toLowerCase();
    const lbl = String(item.label || '').toLowerCase();
    const dk = String(item.dataKey || '').toLowerCase();
    const isBlokI = sec.includes('blok i') || sec.includes('anggota') || sec.includes('art');
    const isUsahaQ = lbl.includes('memiliki usaha') || lbl.includes('kegiatan usaha') || dk.includes('art_usaha');
    const isRadio = Array.isArray(item.options) &&
      item.options.some((o) => String(o.value) === '1') &&
      item.options.some((o) => String(o.value) === '2');

    if (isBlokI && (isUsahaQ || dk === 'art_usaha') && isRadio) {
      blokIArtUsaha = item.dataKey;
      break;
    }
  }
  if (!blokIArtUsaha) {
    blokIArtUsaha = DATAKEYS.BLOK_I_ART_USAHA || 'art_usaha';
  }

  // D. NAMA_KK
  let namaKkKey = null;
  const candidateKk = ['nama_kk', 'dtsen_nama_kk', 'nama_krt', 'sls_nama_kk', 'nama_kepala_keluarga'];
  if (answers && answers.length) {
    for (const cand of candidateKk) {
      const found = answers.find((a) => a.dataKey === cand && a.answer != null && String(a.answer).trim() !== '');
      if (found) {
        namaKkKey = cand;
        break;
      }
    }
  }
  if (!namaKkKey) {
    for (const cand of candidateKk) {
      if (F && F.schema && F.schema(cand)) {
        namaKkKey = cand;
        break;
      }
    }
  }
  if (!namaKkKey) {
    namaKkKey = DATAKEYS.NAMA_KK || 'nama_kk';
  }

  // E. FIELD_NAMA_USAHA: Tambahkan field nama usaha yang terdeteksi dari skema Blok II
  const fieldUsahaList = [...((injectedKeys && injectedKeys.FIELD_NAMA_USAHA) || DATAKEYS.FIELD_NAMA_USAHA || ['nama_usaha', 'nama_usaha_edit', 'nama_komersial'])];
  for (const item of allSchemaItems) {
    if (item.section === sectionBlokII) {
      const lbl = String(item.label || '').toLowerCase();
      const dk = String(item.dataKey || '').toLowerCase();
      if ((lbl.includes('nama usaha') || lbl.includes('nama komersial') || dk.includes('nama_usaha')) && !fieldUsahaList.includes(item.dataKey)) {
        fieldUsahaList.push(item.dataKey);
      }
    }
  }

  // Gabungkan hasil resolusi
  const resolved = {
    WHITELIST_STATUS: (injectedKeys && injectedKeys.WHITELIST_STATUS) || DATAKEYS.WHITELIST_STATUS,
    KODE_BANG: (injectedKeys && injectedKeys.KODE_BANG) || DATAKEYS.KODE_BANG || 'kode_bang',
    NAMA_KK: namaKkKey,
    BLOK_P_PERTANIAN: blokPPertanian,
    BLOK_P_NON_PERTANIAN: blokPNonPertanian,
    BLOK_I_ART_USAHA: blokIArtUsaha,
    SECTION_BLOK_II: sectionBlokII,
    FIELD_NAMA_USAHA: fieldUsahaList,
    SUMMARY_FIELDS: (injectedKeys && injectedKeys.SUMMARY_FIELDS) || DATAKEYS.SUMMARY_FIELDS,
  };

  CACHED_RESOLVED_KEYS = resolved;
  return resolved;
}

/**
 * State Circuit Breaker di level modul.
 * CATATAN KEAMANAN:
 * - Counter direset pada SETIAP return tanpa error (baik status OK maupun LEWATI).
 * - Saat breaker aktif, script langsung MELEMPAR error.
 */
let consecutiveFailures = 0;
let circuitTripped = false;

function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitTripped = false;
}

/**
 * Penulisan aman (safeSet):
 * 1. Jika skema punya options (array non-kosong), SELALU pakai jalur opsi [{...opt, open:false}] tanpa melihat nilai type.
 * 2. Untuk field tanpa options: pertahankan tipe nilai yang sudah ada di dokumen:
 *    - number tetap number
 *    - boolean tetap boolean
 *    - string tetap string
 *    - array tetap array
 *    Jika nilai baru tidak cocok dengan tipe nilai lama, lempar error!
 *    Jangan menulis '0' untuk field yang aslinya angka atau 'false' untuk yang aslinya boolean,
 *    apa pun nilai type di skema (termasuk type: 4).
 * 3. Dilarang menambah key baru ke doc.answers secara diam-diam.
 */
function safeSet(doc, schemaFn, key, valCode) {
  const base = key.replace(/#\d+$/, '');
  const f = typeof schemaFn === 'function' ? schemaFn(base) : (schemaFn && schemaFn.get ? schemaFn.get(base) : (schemaFn ? schemaFn[base] : null));
  if (!f) {
    throw new Error(`[ASSERTION SKEMA GAGAL] dataKey "${key}" (baseKey "${base}") tidak terdaftar di skema template. Mutasi ditolak.`);
  }

  const row = doc.answers.find((a) => a.dataKey === key);
  if (!row) {
    throw new Error(`[ASSERTION DOKUMEN GAGAL] dataKey "${key}" tidak ditemukan pada answers dokumen riil. Dilarang menambah key baru secara diam-diam.`);
  }

  // 1. Jika skema punya options (array non-kosong), SELALU pakai jalur opsi
  if (Array.isArray(f.options) && f.options.length > 0) {
    const opt = getOptionByValue(f, valCode);
    if (!opt) {
      throw new Error(`[OPSI SKEMA TIDAK DITEMUKAN] Opsi dengan value "${valCode}" tidak ditemukan pada skema field "${key}". Valid: ${f.options.map(o => o.value + '=' + o.label).join(' | ')}`);
    }
    row.answer = [{ ...opt, open: false }];
    return row.answer;
  }

  // 2. Field tanpa options: PERTAHANKAN TIPE NILAI YANG SUDAH ADA DI DOKUMEN
  const oldVal = row.answer;
  let finalVal;

  if (oldVal !== undefined && oldVal !== null) {
    if (typeof oldVal === 'number') {
      if (typeof valCode !== 'number' || Number.isNaN(valCode)) {
        throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" pada dokumen bernilai number (${oldVal}), tetapi nilai baru bukan number (${typeof valCode}: ${JSON.stringify(valCode)}).`);
      }
      finalVal = valCode;
    } else if (typeof oldVal === 'boolean') {
      if (typeof valCode !== 'boolean') {
        throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" pada dokumen bernilai boolean (${oldVal}), tetapi nilai baru bukan boolean (${typeof valCode}: ${JSON.stringify(valCode)}).`);
      }
      finalVal = valCode;
    } else if (typeof oldVal === 'string') {
      if (typeof valCode !== 'string') {
        throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" pada dokumen bernilai string ("${oldVal}"), tetapi nilai baru bukan string (${typeof valCode}: ${JSON.stringify(valCode)}).`);
      }
      finalVal = valCode;
    } else if (Array.isArray(oldVal)) {
      if (!Array.isArray(valCode)) {
        throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" pada dokumen bernilai array, tetapi nilai baru bukan array (${typeof valCode}: ${JSON.stringify(valCode)}).`);
      }
      finalVal = valCode;
    } else {
      throw new Error(`[TIPE DATA TIDAK DIKENAL] Field "${key}" pada dokumen memiliki tipe lama tidak dikenal (${typeof oldVal}). Mutasi ditolak.`);
    }
  } else {
    // Fallback jika field belum memiliki nilai sebelumnya di dokumen
    const BOOL_TYPES = new Set([16, 17]);
    const NUM_TYPES  = new Set([20, 28]);
    const TEXT_TYPES = new Set([25, 30]);

    if (BOOL_TYPES.has(f.type) || typeof valCode === 'boolean') {
      if (typeof valCode !== 'boolean') throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" bertipe boolean, nilai baru bukan boolean.`);
      finalVal = valCode;
    } else if (NUM_TYPES.has(f.type) || typeof valCode === 'number') {
      if (typeof valCode !== 'number' || Number.isNaN(valCode)) throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" bertipe number, nilai baru bukan number.`);
      finalVal = valCode;
    } else if (TEXT_TYPES.has(f.type) || typeof valCode === 'string') {
      if (typeof valCode !== 'string') throw new Error(`[TIPE DATA TIDAK COCOK] Field "${key}" bertipe string, nilai baru bukan string.`);
      finalVal = valCode;
    } else if (Array.isArray(valCode)) {
      finalVal = valCode;
    } else {
      throw new Error(`[TIPE DATA TIDAK DIKENAL] Field "${key}" memiliki tipe ${f.type} (${f.kind || 'unknown'}) tanpa options dan tipe nilai tidak valid.`);
    }
  }

  row.answer = finalVal;
  return finalVal;
}

/**
 * Ekstraksi nomor indeks roster Blok II dari answers berdasarkan section Blok II
 */
function getRosterIndices(answers, keys, schemaFn) {
  const indices = new Set();
  for (const a of answers) {
    const m = a.dataKey.match(/^([a-z0-9_]+)#(\d+)$/i);
    if (m) {
      const base = m[1];
      const idx = m[2];
      const f = typeof schemaFn === 'function' ? schemaFn(base) : (schemaFn && schemaFn.get ? schemaFn.get(base) : (schemaFn ? schemaFn[base] : null));
      // Kriteria utama: section sama dengan SECTION_BLOK_II
      if (f && f.section === keys.SECTION_BLOK_II) {
        indices.add(idx);
      }
    }
  }
  return [...indices].sort((p, q) => Number(p) - Number(q));
}

/* ----------------------------------------------------------------------------
 * INTI PROSES SATU BARIS (EVALUASI BERURUTAN)
 * --------------------------------------------------------------------------*/
async function prosesSatuBaris(row, ctx, injectedKeys = null) {
  const F = ctx.FASIH || (typeof FASIH !== 'undefined' ? FASIH : null);
  if (!F) throw new Error('FASIH API helper tidak ditemukan');

  // 0. Circuit Breaker Check: Lempar error bila breaker aktif
  if (circuitTripped) {
    throw new Error('[CIRCUIT BREAKER AKTIF] Telah terjadi 3 kegagalan sistem berturut-turut. Batch dihentikan demi keamanan data.');
  }

  try {
    // 1. Validasi format assignment_id & Fetch Dokumen
    const aid = String(row.assignment_id || '').trim();
    if (!aid || !/^[0-9a-f-]{36}$/i.test(aid)) {
      throw new Error(`assignment_id "${row.assignment_id}" tidak valid (bukan UUID)`);
    }

    const asg = await F.getAssignment(aid);
    if (!asg || !asg.data) {
      throw new Error(`Dokumen assignment "${aid}" tidak ditemukan di server FASIH atau data kosong`);
    }

    const doc = JSON.parse(asg.data);
    const answers = doc.answers || [];

    // Skema: Pastikan FASIH.init dipanggil satu kali dan dibaca via FASIH.schema(key)
    // general_console.js:142-192 (init mengembalikan SCHEMA Map) & general_console.js:199 (schema(k))
    if (F.schema && !F.schema(DATAKEYS.KODE_BANG) && F.init) {
      await F.init({ assignmentId: aid });
    }

    // Resolusi metadata skema secara dinamis (Auto-Discovery)
    const K = resolveSchemaMetadata(F, answers, injectedKeys);
    const schemaFn = F.schema ? (k) => F.schema(k) : null;

    // 2. Cek kode_bang di dokumen FASIH (harus '2' = Bangunan Campuran)
    const kodeBangAns = getAnswer(answers, K.KODE_BANG);
    const kodeBangSchema = schemaFn ? schemaFn(K.KODE_BANG) : null;
    const isCampuran = kodeBangSchema ? isOptionMatch(kodeBangSchema, kodeBangAns, '2') : (getVal(kodeBangAns) === '2');
    if (!isCampuran) {
      consecutiveFailures = 0; // Reset counter pada return tanpa error
      return {
        skip: true,
        code: 'SKIP_BUKAN_CAMPURAN',
        ket: `Dokumen FASIH bukan Bangunan Campuran (kode_bang = ${getVal(kodeBangAns) || 'kosong'})`
      };
    }

    // 3. Whitelist Status Assignment
    const statusDokumen = String(asg.assignment_status_alias || asg.assignment_status || asg.status || '').trim();
    const statusUpper = statusDokumen.toUpperCase().replace(/\s+/g, '_');
    const isStatusAllowed = K.WHITELIST_STATUS.some((s) => String(s).toUpperCase().replace(/\s+/g, '_') === statusUpper);
    if (!isStatusAllowed) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_STATUS_TIDAK_EDITABLE',
        ket: `Status dokumen "${statusDokumen}" tidak dalam whitelist editable (${K.WHITELIST_STATUS.join(', ')})`
      };
    }

    // 4. Verifikasi Nama KK (Excel vs Dokumen FASIH)
    const namaKkExcelNorm = norm(row.nama_kk);
    const namaKkDocAns = getAnswer(answers, K.NAMA_KK);
    const namaKkDocNorm = norm(typeof namaKkDocAns === 'string' ? namaKkDocAns : getVal(namaKkDocAns));

    if (!namaKkExcelNorm) {
      consecutiveFailures = 0;
      return { skip: true, code: 'SKIP_KK_EXCEL_KOSONG', ket: 'Kolom nama_kk di Excel kosong' };
    }
    if (!namaKkDocNorm) {
      consecutiveFailures = 0;
      return { skip: true, code: 'SKIP_KK_DOKUMEN_KOSONG', ket: `Nama KK di dokumen FASIH (${K.NAMA_KK}) kosong` };
    }
    if (namaKkExcelNorm !== namaKkDocNorm) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_BEDA_KK',
        ket: `Nama KK Excel ("${row.nama_kk}") tidak cocok dengan dokumen ("${namaKkDocAns}")`
      };
    }

    // 5. Assertion Skema Keras (Blok P harus tepat 13 field: 7 pertanian, 6 non-pertanian)
    const seluruhBlokPKeys = [...K.BLOK_P_PERTANIAN, ...K.BLOK_P_NON_PERTANIAN];
    if (seluruhBlokPKeys.length !== 13 || K.BLOK_P_PERTANIAN.length !== 7 || K.BLOK_P_NON_PERTANIAN.length !== 6) {
      throw new Error(
        `[ASSERTION SKEMA GAGAL] Field Blok P harus tepat 13 (7 pertanian, 6 non-pertanian). ` +
        `Terdeteksi: ${K.BLOK_P_PERTANIAN.length} pertanian, ${K.BLOK_P_NON_PERTANIAN.length} non-pertanian. ` +
        `Mutasi dibatalkan demi keamanan data.`
      );
    }
    if (!K.SECTION_BLOK_II) {
      throw new Error('[ASSERTION SKEMA GAGAL] Section Blok II tidak dapat diidentifikasi dari skema. Mutasi dibatalkan.');
    }
    for (const pKey of seluruhBlokPKeys) {
      if (!answers.some((a) => a.dataKey === pKey)) {
        throw new Error(`[ASSERTION SKEMA GAGAL] Field Blok P "${pKey}" tidak ada pada answers dokumen. Mutasi dibatalkan.`);
      }
    }

    // Ekstraksi data roster Blok II (berbasis SECTION_BLOK_II) & ART Blok I
    const rosterIndices = getRosterIndices(answers, K, schemaFn);
    const artYaIndices = [];
    const artPrefix = `${K.BLOK_I_ART_USAHA}#`;
    const artSchema = schemaFn ? schemaFn(K.BLOK_I_ART_USAHA) : null;
    for (const a of answers) {
      if (a.dataKey.startsWith(artPrefix)) {
        const isYa = artSchema ? isOptionMatch(artSchema, a.answer, '1') : (getVal(a.answer) === '1');
        if (isYa) {
          artYaIndices.push(a.dataKey.slice(artPrefix.length));
        }
      }
    }

    // 6. Cek Sudah Nihil (Semua Blok P = Tidak, Roster Kosong, ART Blok I = Tidak)
    const semuaBlokPTidak = seluruhBlokPKeys.every((k) => {
      const f = schemaFn ? schemaFn(k) : null;
      return f ? isOptionMatch(f, getAnswer(answers, k), '2') : (getVal(getAnswer(answers, k)) === '2');
    });
    if (semuaBlokPTidak && rosterIndices.length === 0 && artYaIndices.length === 0) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_SUDAH_NIHIL',
        ket: 'Usaha sudah disesuaikan (sudah nihil)'
      };
    }

    // 7. Cek Inkonsistensi Blok I vs Blok II
    const adaBlokPYa = seluruhBlokPKeys.some((k) => {
      const f = schemaFn ? schemaFn(k) : null;
      return f ? isOptionMatch(f, getAnswer(answers, k), '1') : (getVal(getAnswer(answers, k)) === '1');
    });
    if (artYaIndices.length !== rosterIndices.length || (rosterIndices.length === 0 && (adaBlokPYa || artYaIndices.length > 0))) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_INKONSISTENSI',
        ket: `Inkonsistensi: ${artYaIndices.length} ART Ya di Blok I vs ${rosterIndices.length} usaha di roster Blok II`
      };
    }

    // 8. Cek Multi-Usaha (>= 2 usaha -> LEWATI, jangan pernah mutasi!)
    if (rosterIndices.length >= 2) {
      const daftar = rosterIndices.map((n) => {
        let nm = '';
        for (const f of K.FIELD_NAMA_USAHA) {
          const v = getAnswer(answers, `${f}#${n}`);
          if (v) { nm = typeof v === 'string' ? v : (v[0]?.label || v[0]?.value || String(v)); break; }
        }
        return `#${n} ${nm || '(tanpa nama)'}`;
      }).join(', ');
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_MULTI_USAHA',
        ket: `Memiliki ${rosterIndices.length} usaha: [${daftar}] — Periksa Manual`
      };
    }

    if (rosterIndices.length !== 1) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_JUMLAH_USAHA_ANOMALI',
        ket: `Jumlah usaha di roster = ${rosterIndices.length} (harus tepat 1)`
      };
    }
    const singleIndex = rosterIndices[0];

    // Deteksi Key Roster Bersarang Sebelum Penghapusan (di Section Blok II)
    const hasNested = answers.some((a) => {
      const m = a.dataKey.match(/^([a-z0-9_]+)#/i);
      if (!m) return false;
      const base = m[1];
      const f = schemaFn ? schemaFn(base) : null;
      return f && f.section === K.SECTION_BLOK_II && a.dataKey.includes(`#${singleIndex}#`);
    });
    if (hasNested) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_ROSTER_BERSARANG',
        ket: `Terdapat key roster bersarang pada usaha #${singleIndex} di ${K.SECTION_BLOK_II} — Periksa Manual`
      };
    }

    // 9. Cek Jawaban Pertanian di Blok P (Pemeriksaan 'Ya' dari opsi skema)
    const adaPertanianYa = K.BLOK_P_PERTANIAN.some((k) => {
      const f = schemaFn ? schemaFn(k) : null;
      return f ? isOptionMatch(f, getAnswer(answers, k), '1') : (getVal(getAnswer(answers, k)) === '1');
    });
    const opt = ctx.options || {};
    if (adaPertanianYa && !opt.prosesPertanian) {
      consecutiveFailures = 0;
      return {
        skip: true,
        code: 'SKIP_PERTANIAN',
        ket: 'Ada usaha pertanian di Blok P — Periksa Manual'
      };
    }

    // 10. Verifikasi Nama Usaha
    let namaUsahaDoc = '';
    for (const f of K.FIELD_NAMA_USAHA) {
      const val = getAnswer(answers, `${f}#${singleIndex}`);
      if (val != null) {
        namaUsahaDoc = typeof val === 'string' ? val : (val[0]?.label || val[0]?.value || String(val));
        if (namaUsahaDoc.trim()) break;
      }
    }
    const namaUsahaDocNorm = norm(namaUsahaDoc);
    const namaUsahaExcelNorm = norm(row.nama_usaha);

    let isTanpaVerifikasiNama = false;
    if (namaUsahaExcelNorm) {
      if (namaUsahaExcelNorm !== namaUsahaDocNorm) {
        consecutiveFailures = 0;
        return {
          skip: true,
          code: 'SKIP_BEDA_NAMA_USAHA',
          ket: `Nama usaha Excel ("${row.nama_usaha}") tidak cocok dengan dokumen FASIH ("${namaUsahaDoc}")`
        };
      }
    } else {
      if (!opt.izinNamaUsahaKosong) {
        consecutiveFailures = 0;
        return {
          skip: true,
          code: 'SKIP_NAMA_EXCEL_KOSONG',
          ket: 'Kolom nama_usaha di Excel kosong'
        };
      }
      isTanpaVerifikasiNama = true;
    }

    // 11. MUTASI DOKUMEN (Urutan Blok P -> Blok I -> Blok II)
    const r = await F.patch(aid, (draftDoc) => {
      // a. 13 Field Blok P -> Opsi '2' dari FASIH.schema
      for (const pKey of seluruhBlokPKeys) {
        safeSet(draftDoc, schemaFn, pKey, '2');
      }

      // b. Seluruh ART di Blok I -> Opsi '2' dari FASIH.schema
      for (const a of draftDoc.answers) {
        if (a.dataKey.startsWith(artPrefix)) {
          safeSet(draftDoc, schemaFn, a.dataKey, '2');
        }
      }

      // c. Hapus SEMUA key di SECTION_BLOK_II berindeks usaha tunggal (#singleIndex) dengan splice di tempat
      for (let i = draftDoc.answers.length - 1; i >= 0; i--) {
        const a = draftDoc.answers[i];
        const m = a.dataKey.match(new RegExp(`^([a-z0-9_]+)#${singleIndex}$`, 'i'));
        if (m) {
          const base = m[1];
          const f = typeof schemaFn === 'function' ? schemaFn(base) : (schemaFn && schemaFn.get ? schemaFn.get(base) : (schemaFn ? schemaFn[base] : null));
          if (f && f.section === K.SECTION_BLOK_II) {
            draftDoc.answers.splice(i, 1); // Splice di tempat
          }
        }
      }

      // Verifikasi Sebelum Commit: Jika masih ada key di SECTION_BLOK_II dengan indeks usaha itu -> LEMPAR ERROR!
      const sisaKeyBlokII = draftDoc.answers.filter((a) => {
        const m = a.dataKey.match(new RegExp(`^([a-z0-9_]+)#${singleIndex}(?:#|$)`, 'i'));
        if (m) {
          const base = m[1];
          const f = typeof schemaFn === 'function' ? schemaFn(base) : (schemaFn && schemaFn.get ? schemaFn.get(base) : (schemaFn ? schemaFn[base] : null));
          if (f && f.section === K.SECTION_BLOK_II) {
            return true;
          }
        }
        return false;
      });
      if (sisaKeyBlokII.length > 0) {
        throw new Error(`[SISA KEY ROSTER TERDETEKSI] Masih ditemukan key di section "${K.SECTION_BLOK_II}" untuk usaha #${singleIndex} setelah splice: ${sisaKeyBlokII.map(x => x.dataKey).join(', ')}. Mutasi dibatalkan.`);
      }

      // d. Ringkasan: HANYA diubah jika key-nya sudah ada di dokumen
      // Pertahankan tipe nilai dokumen asli: number tetap number, boolean tetap boolean, string tetap string
      const SF = K.SUMMARY_FIELDS;
      if (draftDoc.answers.some((a) => a.dataKey === SF.jumlah_usaha)) {
        const row = draftDoc.answers.find((a) => a.dataKey === SF.jumlah_usaha);
        const val = typeof row.answer === 'string' ? '0' : 0;
        safeSet(draftDoc, schemaFn, SF.jumlah_usaha, val);
      }
      if (draftDoc.answers.some((a) => a.dataKey === SF.jumlah_usaha_ditemukan)) {
        const row = draftDoc.answers.find((a) => a.dataKey === SF.jumlah_usaha_ditemukan);
        const val = typeof row.answer === 'number' ? 0 : '0';
        safeSet(draftDoc, schemaFn, SF.jumlah_usaha_ditemukan, val);
      }
      if (draftDoc.answers.some((a) => a.dataKey === SF.ec_ada_usaha)) {
        const row = draftDoc.answers.find((a) => a.dataKey === SF.ec_ada_usaha);
        const val = typeof row.answer === 'string' ? 'false' : false;
        safeSet(draftDoc, schemaFn, SF.ec_ada_usaha, val);
      }
      if (draftDoc.answers.some((a) => a.dataKey === SF.label_usaha)) {
        safeSet(draftDoc, schemaFn, SF.label_usaha, '');
      }
      if (draftDoc.answers.some((a) => a.dataKey === SF.art_pengusaha)) {
        safeSet(draftDoc, schemaFn, SF.art_pengusaha, []);
      }
    }, { dryRun: ctx.dryRun, log: false });

    // Sukses: Reset counter kegagalan berturut-turut pada return OK
    consecutiveFailures = 0;

    const labelStatus = isTanpaVerifikasiNama
      ? 'OK (tanpa verifikasi nama usaha)'
      : 'OK (Usaha CAWI Dihilangkan)';
    const versiTeks = ctx.dryRun ? `v${r.version}` : `v${r.version} → v${r.versionAfter}`;

    return {
      status: 'OK',
      code: asg.code_identity || aid,
      ket: `${labelStatus} · ${r.nChanges} perubahan · ${versiTeks}`
    };

  } catch (err) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      circuitTripped = true;
      console.error(`[CIRCUIT BREAKER] Terjadi 3 kegagalan sistem berturut-turut! Circuit breaker diaktifkan.`);
    }
    throw err;
  }
}

/* ----------------------------------------------------------------------------
 * REGISTRASI PANEL FASIH BATCH (Sesuai panel.js:8-19, 499-500, 515-530)
 * --------------------------------------------------------------------------*/
if (typeof FASIH_BATCH !== 'undefined') {
  FASIH_BATCH.register({
    id: 'penyesuaian-usaha-cawi',
    name: 'Penyesuaian Usaha CAWI (Keluarga SE2026)',
    description: 'Menihilkan usaha keluarga Bangunan Campuran yang sudah tercatat via CAWI',
    columns: [
      { key: 'assignment_id',   title: 'assignment_id', type: 'uuid', required: true, unique: false },
      { key: 'nama_kk',         title: 'nama_kk',       type: 'text' },
      { key: 'nama_usaha',      title: 'nama_usaha',    type: 'text' },
      { key: 'nama_pengusaha',  title: 'nama_pengusaha (opsional)', type: 'text' },
      { key: 'kode_bang_label', title: 'kode_bang_label (opsional)', type: 'text' },
    ],
    idColumn: 'assignment_id',
    options: [
      { key: 'jeda',                 label: 'Jeda per baris (ms)', type: 'number',   default: 3000 },
      { key: 'backup',               label: 'Backup sebelum LIVE', type: 'checkbox', default: true },
      { key: 'prosesPertanian',      label: 'Proses meski ada usaha Pertanian di Blok P (Hati-hati)', type: 'checkbox', default: false },
      { key: 'izinNamaUsahaKosong',  label: 'Proses meski Kolom nama_usaha di Excel kosong', type: 'checkbox', default: false },
    ],

    // panel.js:499-500: m.before dipanggil sebelum loop iterasi baris
    async before(rows, ctx) {
      resetCircuitBreaker();
      resetResolvedKeysCache();
      if (rows && rows.length && rows[0].assignment_id && ctx.FASIH && ctx.FASIH.init) {
        try {
          await ctx.FASIH.init({ assignmentId: rows[0].assignment_id });
        } catch (e) {
          console.warn('[FASIH_BATCH] FASIH.init di before() gagal, akan dicoba ulang di prosesSatuBaris:', e.message);
        }
      }
      console.log(`[FASIH_BATCH] Memulai batch penyesuaian usaha CAWI (${rows.length} baris). Mode: ${ctx.dryRun ? 'DRY RUN' : 'LIVE'}`);
    },

    // panel.js:515: runner memanggil m.process(item, { ...ctx, index, rowNumber, remarks })
    async process(row, ctx) {
      return prosesSatuBaris(row, ctx);
    },
  });
}

// Ekspor untuk pengujian offline (Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DATAKEYS,
    norm,
    getVal,
    getAnswer,
    safeSet,
    getRosterIndices,
    resetCircuitBreaker,
    resolveSchemaMetadata,
    resetResolvedKeysCache,
    prosesSatuBaris,
    _getCircuitState: () => ({ consecutiveFailures, circuitTripped }),
    _setCircuitState: (f, t) => { consecutiveFailures = f; circuitTripped = t; }
  };
}
