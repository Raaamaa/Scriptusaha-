/**
 * test-penyesuaian-usaha-cawi.js
 * Pengujian offline mandiri untuk batch-automation - penyesuaian usaha cawi.js
 * Dijalankan dengan: node test-penyesuaian-usaha-cawi.js
 */

const assert = require('assert');
const {
  DATAKEYS,
  safeSet,
  resetCircuitBreaker,
  resolveSchemaMetadata,
  resetResolvedKeysCache,
  prosesSatuBaris,
  _getCircuitState
} = require('./batch-automation - penyesuaian usaha cawi.js');

// Mock DataKeys siap uji
const TEST_KEYS = {
  WHITELIST_STATUS: ['ASSIGNED', 'IN_PROGRESS'],
  KODE_BANG: 'kode_bang',
  NAMA_KK: 'nama_kk',
  BLOK_P_PERTANIAN: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
  BLOK_P_NON_PERTANIAN: ['p8', 'p9', 'p10', 'p11', 'p12', 'p13'],
  BLOK_I_ART_USAHA: 'art_usaha',
  SECTION_BLOK_II: 'BLOK II',
  FIELD_NAMA_USAHA: ['nama_usaha', 'nama_komersial'],
  SUMMARY_FIELDS: {
    jumlah_usaha: 'jumlah_usaha',
    jumlah_usaha_ditemukan: 'jumlah_usaha_ditemukan',
    ec_ada_usaha: 'ec_ada_usaha',
    label_usaha: 'label_usaha',
    art_pengusaha: 'art_pengusaha',
  }
};

// Mock Skema
function createMockSchema({ omitOption2ForP1 = false } = {}) {
  const schemaMap = new Map([
    ['kode_bang', { type: 26, kind: 'radio', section: 'BLOK I', options: [{ value: '1', label: '1. BKU' }, { value: '2', label: '2. Campuran' }] }],
    ['nama_kk', { type: 25, kind: 'text', section: 'BLOK I' }],
    ['nama_art', { type: 25, kind: 'text', section: 'BLOK I' }],
    ['jk', { type: 26, kind: 'radio', section: 'BLOK I', options: [{ value: '1', label: '1. Laki-laki' }, { value: '2', label: '2. Perempuan' }] }],
    ['art_usaha', { type: 26, kind: 'radio', section: 'BLOK I', options: [{ value: '1', label: '1. Ya' }, { value: '2', label: '2. Tidak' }] }],

    // Roster Blok II (Section: 'BLOK II')
    ['nama_usaha', { type: 25, kind: 'text', section: 'BLOK II' }],
    ['omset', { type: 20, kind: 'number', section: 'BLOK II' }],
    ['kbli', { type: 25, kind: 'text', section: 'BLOK II' }],
    ['modal', { type: 20, kind: 'number', section: 'BLOK II' }],
    // Field Blok II yang TIDAK ada di whitelist lama:
    ['field_baru_blok2', { type: 25, kind: 'text', section: 'BLOK II' }],
    ['sisa_field_blok2', { type: 25, kind: 'text', section: 'BLOK II' }],

    // Section Lain
    ['catatan_umum', { type: 25, kind: 'text', section: 'CATATAN' }],

    // Summary Fields: bertipe 4 (variable/hidden) untuk verifikasi angka & boolean
    ['jumlah_usaha', { type: 4, kind: 'variable', section: 'RINGKASAN' }],
    ['jumlah_usaha_ditemukan', { type: 25, kind: 'text', section: 'RINGKASAN' }],
    ['ec_ada_usaha', { type: 4, kind: 'variable', section: 'RINGKASAN' }],
    ['label_usaha', { type: 25, kind: 'text', section: 'RINGKASAN' }],
    ['art_pengusaha', { type: 29, kind: 'nested', section: 'RINGKASAN' }],
  ]);

  for (let i = 1; i <= 13; i++) {
    const opts = (i === 1 && omitOption2ForP1)
      ? [{ value: '1', label: '1. Ya' }]
      : [{ value: '1', label: '1. Ya' }, { value: '2', label: '2. Tidak' }];
    schemaMap.set(`p${i}`, { type: 26, kind: 'radio', section: 'BLOK P', options: opts });
  }
  return schemaMap;
}

function createRealisticDoc() {
  const answers = [
    { dataKey: 'kode_bang', answer: [{ value: '2', label: '2. Campuran' }] },
    { dataKey: 'nama_kk', answer: 'BUDI SANTOSO' },

    // 13 Field Blok P (p1..p7 = 2. Tidak, p8..p13 = 1. Ya)
    { dataKey: 'p1', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p2', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p3', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p4', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p5', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p6', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p7', answer: [{ value: '2', label: '2. Tidak' }] },
    { dataKey: 'p8', answer: [{ value: '1', label: '1. Ya' }] },
    { dataKey: 'p9', answer: [{ value: '1', label: '1. Ya' }] },
    { dataKey: 'p10', answer: [{ value: '1', label: '1. Ya' }] },
    { dataKey: 'p11', answer: [{ value: '1', label: '1. Ya' }] },
    { dataKey: 'p12', answer: [{ value: '1', label: '1. Ya' }] },
    { dataKey: 'p13', answer: [{ value: '1', label: '1. Ya' }] },

    // Blok I: ART dengan indeks #1 (SITI AMINAH) dan #2 (AHMAD)
    { dataKey: 'nama_art#1', answer: 'SITI AMINAH' },
    { dataKey: 'jk#1', answer: [{ value: '2', label: '2. Perempuan' }] },
    { dataKey: 'art_usaha#1', answer: [{ value: '1', label: '1. Ya' }] },

    { dataKey: 'nama_art#2', answer: 'AHMAD' },
    { dataKey: 'jk#2', answer: [{ value: '1', label: '1. Laki-laki' }] },
    { dataKey: 'art_usaha#2', answer: [{ value: '2', label: '2. Tidak' }] },

    // Blok II: Roster Usaha Tunggal (indeks #1)
    { dataKey: 'nama_usaha#1', answer: 'WARUNG MAJU' },
    { dataKey: 'omset#1', answer: 5000000 },
    { dataKey: 'kbli#1', answer: '47111' },
    { dataKey: 'modal#1', answer: 10000000 },
    // Field Blok II yang tidak ada di whitelist lama:
    { dataKey: 'field_baru_blok2#1', answer: 'FIELD BARU DI BLOK II' },

    // Section Lain
    { dataKey: 'catatan_umum', answer: 'Data terkumpul' },

    // Ringkasan: tipe 4 di skema, nilai awal angka dan boolean
    { dataKey: 'jumlah_usaha', answer: 1 },
    { dataKey: 'jumlah_usaha_ditemukan', answer: '1' },
    { dataKey: 'ec_ada_usaha', answer: true },
    { dataKey: 'label_usaha', answer: 'WARUNG MAJU' },
    { dataKey: 'art_pengusaha', answer: [{ value: '1' }] },
  ];

  return {
    assignment_status_alias: 'ASSIGNED',
    code_identity: '3328100001001',
    data: JSON.stringify({
      version: 1,
      answers
    })
  };
}

async function runTests() {
  console.log('=== MEMULAI TEST OFFLINE (LENGKAP & REALISTIS) ===\n');

  // UJI 1: Opsi tidak ditemukan di skema -> GAGAL tanpa tulis
  {
    resetCircuitBreaker();
    const badSchema = createMockSchema({ omitOption2ForP1: true });
    const mockFASIH = {
      getAssignment: async () => createRealisticDoc(),
      schema: (k) => badSchema.get(k),
      patch: async (id, fn) => {
        const draft = JSON.parse(createRealisticDoc().data);
        fn(draft);
      }
    };
    const row = { assignment_id: '00000000-0000-0000-0000-000000000001', nama_kk: 'BUDI SANTOSO', nama_usaha: 'WARUNG MAJU' };
    let errorThrown = false;
    try {
      await prosesSatuBaris(row, { FASIH: mockFASIH }, TEST_KEYS);
    } catch (e) {
      errorThrown = true;
      assert(e.message.includes('OPSI SKEMA TIDAK DITEMUKAN'));
    }
    assert.strictEqual(errorThrown, true);
    console.log('[PASS] 1. Opsi tidak ditemukan di skema -> GAGAL tanpa tulis');
  }

  // UJI 2: Sisa key di Section Blok II setelah splice -> GAGAL
  {
    resetCircuitBreaker();
    const goodSchema = createMockSchema();
    const docWithRemainingBlok2 = createRealisticDoc();

    const mockFASIH = {
      getAssignment: async () => docWithRemainingBlok2,
      schema: (k) => goodSchema.get(k),
      patch: async (id, fn) => {
        const draft = JSON.parse(docWithRemainingBlok2.data);
        // Simulasikan kegagalan splice satu key di Blok II agar memicu deteksi sisa key
        const origSplice = draft.answers.splice.bind(draft.answers);
        draft.answers.splice = function(start, deleteCount) {
          if (draft.answers[start] && draft.answers[start].dataKey === 'nama_usaha#1') {
            return []; // Lewatkan penghapusan nama_usaha#1
          }
          return origSplice(start, deleteCount);
        };
        fn(draft);
      }
    };
    const row = { assignment_id: '00000000-0000-0000-0000-000000000002', nama_kk: 'BUDI SANTOSO', nama_usaha: 'WARUNG MAJU' };
    let errorThrown = false;
    try {
      await prosesSatuBaris(row, { FASIH: mockFASIH }, TEST_KEYS);
    } catch (e) {
      errorThrown = true;
      assert(e.message.includes('SISA KEY ROSTER TERDETEKSI'));
    }
    assert.strictEqual(errorThrown, true);
    console.log('[PASS] 2. Sisa key di Section Blok II setelah splice -> GAGAL');
  }

  // UJI 3: Circuit breaker tidak terpicu oleh GAGAL terpisah LEWATI & melempar error saat aktif
  {
    resetCircuitBreaker();
    const goodSchema = createMockSchema();
    const mockFASIH = {
      getAssignment: async () => {
        // Dokumen BKU untuk trigger LEWATI
        const doc = createRealisticDoc();
        const p = JSON.parse(doc.data);
        p.answers.find(a => a.dataKey === 'kode_bang').answer = [{ value: '1', label: '1. BKU' }];
        doc.data = JSON.stringify(p);
        return doc;
      },
      schema: (k) => goodSchema.get(k)
    };

    const rowFail = { assignment_id: '00000000-0000-0000-0000-00000000000a', nama_kk: 'BUDI', nama_usaha: 'A' };
    const rowSkip = { assignment_id: '00000000-0000-0000-0000-00000000000b', nama_kk: 'BUDI', nama_usaha: 'A' };

    // Gagal 1
    try { await prosesSatuBaris(rowFail, { FASIH: { ...mockFASIH, getAssignment: async () => { throw new Error('ERR'); } } }, TEST_KEYS); } catch {}
    assert.strictEqual(_getCircuitState().consecutiveFailures, 1);

    // 5 LEWATI -> counter wajib reset ke 0 pada SETIAP LEWATI
    for (let i = 0; i < 5; i++) {
      const res = await prosesSatuBaris(rowSkip, { FASIH: mockFASIH }, TEST_KEYS);
      assert.strictEqual(res.skip, true);
      assert.strictEqual(_getCircuitState().consecutiveFailures, 0);
    }

    // 3 Gagal berturut-turut
    for (let i = 0; i < 3; i++) {
      try { await prosesSatuBaris(rowFail, { FASIH: { ...mockFASIH, getAssignment: async () => { throw new Error('ERR'); } } }, TEST_KEYS); } catch {}
    }
    assert.strictEqual(_getCircuitState().circuitTripped, true);

    // Panggilan berikutnya: LEMPAR error
    let threw = false;
    try {
      await prosesSatuBaris(rowSkip, { FASIH: mockFASIH }, TEST_KEYS);
    } catch (e) {
      threw = true;
      assert(e.message.includes('CIRCUIT BREAKER AKTIF'));
    }
    assert.strictEqual(threw, true);
    console.log('[PASS] 3. Breaker tidak terpicu oleh GAGAL terpisah LEWATI & melempar error saat aktif');
  }

  // UJI 4: 2 usaha -> dokumen identik (tidak ada tulis)
  {
    resetCircuitBreaker();
    let patchCalled = false;
    const doc2 = createRealisticDoc();
    const p = JSON.parse(doc2.data);
    p.answers.push({ dataKey: 'nama_usaha#2', answer: 'BENGKEL' });
    p.answers.push({ dataKey: 'omset#2', answer: 2000000 });
    // Pastikan ART 2 juga Ya agar konsisten 2 usaha (artYa == 2, roster == 2)
    p.answers.find(a => a.dataKey === 'art_usaha#2').answer = [{ value: '1', label: '1. Ya' }];
    doc2.data = JSON.stringify(p);
    const origJson = doc2.data;

    const mockFASIH = {
      getAssignment: async () => doc2,
      schema: (k) => createMockSchema().get(k),
      patch: async () => { patchCalled = true; }
    };
    const row = { assignment_id: '00000000-0000-0000-0000-000000000004', nama_kk: 'BUDI SANTOSO', nama_usaha: 'WARUNG MAJU' };
    const res = await prosesSatuBaris(row, { FASIH: mockFASIH }, TEST_KEYS);

    assert.strictEqual(res.skip, true);
    assert.strictEqual(res.code, 'SKIP_MULTI_USAHA');
    assert.strictEqual(patchCalled, false);
    assert.strictEqual(doc2.data, origJson);
    console.log('[PASS] 4. 2 usaha -> dokumen identik (tidak ada tulis)');
  }

  // UJI 5: Nama usaha Excel tidak cocok -> LEWATI tanpa tulis
  {
    resetCircuitBreaker();
    let patchCalled = false;
    const mockFASIH = {
      getAssignment: async () => createRealisticDoc(),
      schema: (k) => createMockSchema().get(k),
      patch: async () => { patchCalled = true; }
    };
    const row = { assignment_id: '00000000-0000-0000-0000-000000000005', nama_kk: 'BUDI SANTOSO', nama_usaha: 'TOKO KELONTONG BEDA' };
    const res = await prosesSatuBaris(row, { FASIH: mockFASIH }, TEST_KEYS);

    assert.strictEqual(res.skip, true);
    assert.strictEqual(res.code, 'SKIP_BEDA_NAMA_USAHA');
    assert.strictEqual(patchCalled, false);
    console.log('[PASS] 5. Nama usaha Excel tidak cocok -> LEWATI tanpa tulis');
  }

  // UJI 6: Jalur Sukses Realistis (Mock patch menghitung nChanges dari diff dokumen seperti general_console.js)
  {
    resetCircuitBreaker();
    const schema = createMockSchema();
    const doc = createRealisticDoc();
    const originalParsed = JSON.parse(doc.data);
    let patchedDoc = null;

    // Mock patch meniru persis submitEdit di lib/general_console.js:298–324
    const mockFASIH = {
      getAssignment: async () => doc,
      schema: (k) => schema.get(k),
      patch: async (id, fn) => {
        const draft = JSON.parse(JSON.stringify(originalParsed));
        const snapshot = new Map(draft.answers.map((a) => [a.dataKey, JSON.stringify(a.answer)]));
        fn(draft);
        patchedDoc = draft;

        // Diff dokumen asli (general_console.js:304–311)
        const changes = [];
        for (const a of draft.answers) {
          const after = JSON.stringify(a.answer);
          if (!snapshot.has(a.dataKey)) {
            changes.push({ dataKey: a.dataKey });
          } else if (snapshot.get(a.dataKey) !== after) {
            changes.push({ dataKey: a.dataKey });
          }
        }
        return { version: 1, versionAfter: 2, nChanges: changes.length };
      }
    };
    const row = { assignment_id: '00000000-0000-0000-0000-000000000006', nama_kk: 'BUDI SANTOSO', nama_usaha: 'WARUNG MAJU' };
    const res = await prosesSatuBaris(row, { FASIH: mockFASIH, dryRun: false }, TEST_KEYS);

    assert.strictEqual(res.status, 'OK');
    assert(res.ket.includes('OK (Usaha CAWI Dihilangkan)'));
    assert(patchedDoc != null);

    // 1. nChanges dihitung dari diff dokumen riil (bukan konstanta 18):
    // Nilai terubah: 13 field Blok P + 2 art_usaha Blok I + 5 summary fields = 20 field
    assert(res.ket.includes('20 perubahan'), `nChanges harus bernilai 20 dari diff dokumen, didapat: ${res.ket}`);

    // 2. 13 Field Blok P = opsi '2' berformat [{label, value, ...}]
    for (let i = 1; i <= 13; i++) {
      const a = patchedDoc.answers.find(x => x.dataKey === `p${i}`);
      assert(Array.isArray(a.answer), `p${i} harus berupa array`);
      assert.strictEqual(a.answer[0].value, '2', `p${i} value harus '2'`);
      assert.strictEqual(a.answer[0].label, '2. Tidak', `p${i} label harus '2. Tidak'`);
    }

    // 3. art_usaha#n seluruhnya '2' berformat [{label, value, ...}]
    const art1 = patchedDoc.answers.find(x => x.dataKey === 'art_usaha#1');
    const art2 = patchedDoc.answers.find(x => x.dataKey === 'art_usaha#2');
    assert.strictEqual(art1.answer[0].value, '2');
    assert.strictEqual(art2.answer[0].value, '2');

    // 4. Semua key roster usaha tunggal Blok II hilang (termasuk field_baru_blok2 yang tidak ada di whitelist lama!)
    assert.strictEqual(patchedDoc.answers.find(x => x.dataKey === 'nama_usaha#1'), undefined);
    assert.strictEqual(patchedDoc.answers.find(x => x.dataKey === 'omset#1'), undefined);
    assert.strictEqual(patchedDoc.answers.find(x => x.dataKey === 'kbli#1'), undefined);
    assert.strictEqual(patchedDoc.answers.find(x => x.dataKey === 'modal#1'), undefined);
    assert.strictEqual(patchedDoc.answers.find(x => x.dataKey === 'field_baru_blok2#1'), undefined, 'Field Blok II di luar whitelist lama wajib terhapus!');

    // 5. Key ART lain dengan indeks sama UTUH dan tidak berubah
    const namaArt1 = patchedDoc.answers.find(x => x.dataKey === 'nama_art#1');
    const jk1 = patchedDoc.answers.find(x => x.dataKey === 'jk#1');
    assert.strictEqual(namaArt1.answer, 'SITI AMINAH', 'nama_art#1 dilarang terhapus/berubah!');
    assert.strictEqual(jk1.answer[0].value, '2', 'jk#1 dilarang terhapus/berubah!');

    // 6. Key di section lain UTUH dan tidak berubah
    const cat = patchedDoc.answers.find(x => x.dataKey === 'catatan_umum');
    assert.strictEqual(cat.answer, 'Data terkumpul', 'catatan_umum dilarang berubah!');

    // 7. Ringkasan: tipe 4 di skema, nilai awal angka dan boolean TETAP bertipe number dan boolean!
    const ju = patchedDoc.answers.find(x => x.dataKey === 'jumlah_usaha');
    const jud = patchedDoc.answers.find(x => x.dataKey === 'jumlah_usaha_ditemukan');
    const ec = patchedDoc.answers.find(x => x.dataKey === 'ec_ada_usaha');
    const lu = patchedDoc.answers.find(x => x.dataKey === 'label_usaha');
    const ap = patchedDoc.answers.find(x => x.dataKey === 'art_pengusaha');

    assert.strictEqual(typeof ju.answer, 'number', 'jumlah_usaha harus tetap number 0');
    assert.strictEqual(ju.answer, 0);
    assert.strictEqual(typeof jud.answer, 'string', 'jumlah_usaha_ditemukan harus tetap string "0"');
    assert.strictEqual(jud.answer, '0');
    assert.strictEqual(typeof ec.answer, 'boolean', 'ec_ada_usaha harus tetap boolean false');
    assert.strictEqual(ec.answer, false);
    assert.strictEqual(lu.answer, '');
    assert.deepStrictEqual(ap.answer, []);

    // 8. Diff terhadap dokumen asli hanya menghapus key roster Blok II
    const deletedKeys = originalParsed.answers
      .map(x => x.dataKey)
      .filter(k => !patchedDoc.answers.some(y => y.dataKey === k));
    assert.deepStrictEqual(deletedKeys.sort(), ['field_baru_blok2#1', 'kbli#1', 'modal#1', 'nama_usaha#1', 'omset#1'].sort());

    console.log('[PASS] 6. Jalur Sukses Realistis: Blok P/I nihil, Roster Blok II non-whitelist terhapus, ART #1 & catatan UTUH, Ringkasan tipe 4 tetap number/boolean, nChanges dihitung dari diff');
  }

  // UJI 7: safeSet mempertahankan tipe asli & menolak tipe yang tidak cocok
  {
    const schema = createMockSchema();
    const doc = {
      answers: [
        { dataKey: 'jumlah_usaha', answer: 5 },          // tipe 4 di skema, awal number
        { dataKey: 'ec_ada_usaha', answer: true },       // tipe 4 di skema, awal boolean
        { dataKey: 'catatan_umum', answer: 'asli' },     // tipe 25 di skema, awal string
        { dataKey: 'art_pengusaha', answer: [1, 2] },    // tipe 29 di skema, awal array
      ]
    };

    // 1. Sukses jika tipe cocok (angka tetap angka, boolean tetap boolean, string tetap string, array tetap array)
    safeSet(doc, (k) => schema.get(k), 'jumlah_usaha', 0);
    assert.strictEqual(typeof doc.answers[0].answer, 'number');
    assert.strictEqual(doc.answers[0].answer, 0);

    safeSet(doc, (k) => schema.get(k), 'ec_ada_usaha', false);
    assert.strictEqual(typeof doc.answers[1].answer, 'boolean');
    assert.strictEqual(doc.answers[1].answer, false);

    safeSet(doc, (k) => schema.get(k), 'catatan_umum', 'baru');
    assert.strictEqual(typeof doc.answers[2].answer, 'string');
    assert.strictEqual(doc.answers[2].answer, 'baru');

    safeSet(doc, (k) => schema.get(k), 'art_pengusaha', []);
    assert.strictEqual(Array.isArray(doc.answers[3].answer), true);

    // 2. Lempar error jika mencoba menulis '0' (string) ke field yang aslinya angka
    let errNumber = false;
    try {
      safeSet(doc, (k) => schema.get(k), 'jumlah_usaha', '0');
    } catch (e) {
      errNumber = true;
      assert(e.message.includes('TIPE DATA TIDAK COCOK'));
    }
    assert.strictEqual(errNumber, true, 'Wajib lempar error jika menulis string "0" ke field number');

    // 3. Lempar error jika mencoba menulis 'false' (string) ke field yang aslinya boolean
    let errBool = false;
    try {
      safeSet(doc, (k) => schema.get(k), 'ec_ada_usaha', 'false');
    } catch (e) {
      errBool = true;
      assert(e.message.includes('TIPE DATA TIDAK COCOK'));
    }
    assert.strictEqual(errBool, true, 'Wajib lempar error jika menulis string "false" ke field boolean');

    // 4. Lempar error jika mencoba menulis number ke field string
    let errStr = false;
    try {
      safeSet(doc, (k) => schema.get(k), 'catatan_umum', 123);
    } catch (e) {
      errStr = true;
      assert(e.message.includes('TIPE DATA TIDAK COCOK'));
    }
    assert.strictEqual(errStr, true, 'Wajib lempar error jika menulis number ke field string');

    // 5. Lempar error jika mencoba menulis non-array ke field array
    let errArr = false;
    try {
      safeSet(doc, (k) => schema.get(k), 'art_pengusaha', 'bukan-array');
    } catch (e) {
      errArr = true;
      assert(e.message.includes('TIPE DATA TIDAK COCOK'));
    }
    assert.strictEqual(errArr, true, 'Wajib lempar error jika menulis non-array ke field array');

    console.log('[PASS] 7. safeSet: pertahankan tipe nilai dokumen asli (number/boolean/string/array) & lempar error jika tidak cocok');
  }

  // UJI 8: Auto-Discovery Skema (Plug-and-Play tanpa injectedKeys)
  {
    resetCircuitBreaker();
    resetResolvedKeysCache();

    // Bangun skema SE2026 realistis dengan Section SE2026 asli
    const se2026Schema = new Map([
      ['kode_bang', { type: 26, kind: 'radio', section: 'SE2026 - L BLOK I', options: [{ value: '1', label: '1. BKU' }, { value: '2', label: '2. Campuran' }] }],
      ['nama_kk', { type: 25, kind: 'text', section: 'SE2026 - L BLOK I' }],
      ['nama_art', { type: 25, kind: 'text', section: 'SE2026 - L BLOK I' }],
      ['jk', { type: 26, kind: 'radio', section: 'SE2026 - L BLOK I', options: [{ value: '1', label: '1. Laki-laki' }, { value: '2', label: '2. Perempuan' }] }],
      ['art_usaha', { type: 26, kind: 'radio', label: 'Apakah memiliki usaha?', section: 'SE2026 - L BLOK I', options: [{ value: '1', label: '1. Ya' }, { value: '2', label: '2. Tidak' }] }],

      // Roster Blok II (Section: 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN')
      ['nama_usaha', { type: 25, kind: 'text', section: 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN' }],
      ['omset', { type: 20, kind: 'number', section: 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN' }],
      ['kbli', { type: 25, kind: 'text', section: 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN' }],
      ['modal', { type: 20, kind: 'number', section: 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN' }],
      ['field_baru_blok2', { type: 25, kind: 'text', section: 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN' }],

      // Section Lain
      ['catatan_umum', { type: 25, kind: 'text', section: 'CATATAN' }],

      // Summary Fields
      ['jumlah_usaha', { type: 4, kind: 'variable', section: 'RINGKASAN' }],
      ['jumlah_usaha_ditemukan', { type: 25, kind: 'text', section: 'RINGKASAN' }],
      ['ec_ada_usaha', { type: 4, kind: 'variable', section: 'RINGKASAN' }],
      ['label_usaha', { type: 25, kind: 'text', section: 'RINGKASAN' }],
      ['art_pengusaha', { type: 29, kind: 'nested', section: 'RINGKASAN' }],
    ]);

    const agriLabels = [
      'Pertanian Tanaman Pangan',
      'Pertanian Hortikultura',
      'Perkebunan',
      'Peternakan',
      'Kehutanan',
      'Perikanan',
      'Jasa Pertanian'
    ];
    for (let i = 1; i <= 7; i++) {
      se2026Schema.set(`p${i}`, {
        type: 26, kind: 'radio',
        label: agriLabels[i - 1],
        section: 'SE2026 - P KETERANGAN KELUARGA DAN BANGUNAN',
        options: [{ value: '1', label: '1. Ya' }, { value: '2', label: '2. Tidak' }]
      });
    }

    const nonAgriLabels = [
      'Pertambangan dan Penggalian',
      'Industri Pengolahan',
      'Pengadaan Listrik dan Gas',
      'Konstruksi',
      'Perdagangan Besar dan Eceran',
      'Transportasi dan Pergudangan'
    ];
    for (let i = 8; i <= 13; i++) {
      se2026Schema.set(`p${i}`, {
        type: 26, kind: 'radio',
        label: nonAgriLabels[i - 8],
        section: 'SE2026 - P KETERANGAN KELUARGA DAN BANGUNAN',
        options: [{ value: '1', label: '1. Ya' }, { value: '2', label: '2. Tidak' }]
      });
    }

    let savedDraft = null;
    const mockFASIH = {
      getAssignment: async () => createRealisticDoc(),
      schema: (k) => se2026Schema.get(k),
      _internal: {
        SCHEMA: se2026Schema
      },
      patch: async (id, fn) => {
        const rawDoc = JSON.parse(createRealisticDoc().data);
        const snapshot = new Map(rawDoc.answers.map((a) => [a.dataKey, JSON.stringify(a.answer)]));
        fn(rawDoc);
        savedDraft = rawDoc;
        let diffCount = 0;
        for (const a of rawDoc.answers) {
          const after = JSON.stringify(a.answer);
          if (!snapshot.has(a.dataKey) || snapshot.get(a.dataKey) !== after) {
            diffCount++;
          }
        }
        return {
          ok: true,
          nChanges: diffCount,
          version: 1,
          versionAfter: 2
        };
      }
    };

    // Jalankan prosesSatuBaris TANPA injectedKeys (persis seperti saat di-run di ekstensi)
    const row = { assignment_id: '00000000-0000-0000-0000-000000000001', nama_kk: 'BUDI SANTOSO', nama_usaha: 'WARUNG MAJU' };
    const res = await prosesSatuBaris(row, { FASIH: mockFASIH, dryRun: false });

    assert.strictEqual(res.status, 'OK', 'Harus sukses OK');
    assert(res.ket.includes('OK (Usaha CAWI Dihilangkan)'));

    // Verifikasi auto-discovery mendeteksi komponen skema dengan benar
    const docAnswers = JSON.parse(createRealisticDoc().data).answers;
    const resolved = resolveSchemaMetadata(mockFASIH, docAnswers);

    assert.strictEqual(resolved.SECTION_BLOK_II, 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN');
    assert.strictEqual(resolved.BLOK_P_PERTANIAN.length, 7, 'Wajib 7 field pertanian');
    assert.strictEqual(resolved.BLOK_P_NON_PERTANIAN.length, 6, 'Wajib 6 field non-pertanian');
    assert.deepStrictEqual(resolved.BLOK_P_PERTANIAN, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    assert.deepStrictEqual(resolved.BLOK_P_NON_PERTANIAN, ['p8', 'p9', 'p10', 'p11', 'p12', 'p13']);
    assert.strictEqual(resolved.BLOK_I_ART_USAHA, 'art_usaha');
    assert.strictEqual(resolved.NAMA_KK, 'nama_kk');

    // Verifikasi roster Blok II telah terhapus di draft
    const remainingBlokII = savedDraft.answers.filter((a) => {
      const baseK = a.dataKey.replace(/#\d+.*$/, '');
      const s = se2026Schema.get(baseK);
      return s && s.section === 'SE2026 - L BLOK II KETERANGAN USAHA/PERUSAHAAN';
    });
    assert.strictEqual(remainingBlokII.length, 0, 'Semua key Blok II wajib terhapus');

    // Verifikasi status case-insensitive (mis. 'In Progress' / 'Assigned')
    const docMixedStatus = createRealisticDoc();
    docMixedStatus.assignment_status_alias = 'In Progress';
    const mockFASIH2 = { ...mockFASIH, getAssignment: async () => docMixedStatus };
    const resMixed = await prosesSatuBaris(row, { FASIH: mockFASIH2, dryRun: true });
    assert.strictEqual(resMixed.status, 'OK', 'Status "In Progress" harus diizinkan secara case-insensitive');

    console.log('[PASS] 8. Auto-Discovery Skema: Plug-and-play sukses mendeteksi Section Blok II, 13 Field Blok P (7 Pertanian + 6 Non-Pertanian), ART Blok I, dan nama_kk');
  }

  console.log('\n=== SELURUH PENGUJIAN OFFLINE LOLOS 100% (8/8 SUKSES) ===');
}

runTests();
