"""R5 - Profiling Excel (READ-ONLY, pada SALINAN). Keluaran: evidence/r5_output.txt (tanpa data pribadi).

Nilai identitas (nama KK, nama usaha, nama pengusaha, NIK, alamat) TIDAK dicetak. Hanya hitungan/hash.
"""
import io
import re
import statistics
import sys
import unicodedata
from collections import Counter, defaultdict
from excel_common import COL, UUID, h, load, mask

sys.stdout.reconfigure(encoding="utf-8")
BUF = io.StringIO()


def out(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    BUF.write(s + "\n")


header, rows, meta = load()
LET = [c for c in COL if c != "W"]            # A..V
ALL = list(COL)                               # A..W


def is_blank(r):
    return all(str(r[c]).strip() == "" for c in ALL)


data = [r for r in rows if not is_blank(r)]
blank = [r for r in rows if is_blank(r)]
iid = lambda r: r["A"].strip().lower()
KB = lambda r: r["K"]

# ------------------------------------------------------------------ 5.1
out("=== 5.1 Header, tipe, jumlah baris ===")
out("header (indeks:nama):", {i: n for i, n in enumerate(header)})
out("baris XML setelah header:", len(rows), "| baris data (tidak kosong):", len(data), "| baris kosong:", len(blank))
if blank:
    rn = [r["_r"] for r in blank]
    out("baris kosong: nomor baris Excel min/max:", min(rn), max(rn), "| kontigu di ekor:", rn == list(range(min(rn), max(rn) + 1)) and max(rn) == max(r["_r"] for r in rows))
out("filter Excel (definedName _FilterDatabase): A1:W9076  -> 9075 baris data (1 header)")
out("tipe sel per kolom:")
for L in ALL:
    out("  %s %-18s tipe=%s  terisi=%d" % (L, COL[L], sorted(meta["types"].get(L, [])), sum(1 for r in data if str(r[L]).strip() != "")))
w = [r["W"] for r in data if str(r["W"]).strip() != ""]
out("kolom W (header kosong): terisi=%d, distinct=%d, contoh(mask)=%s" % (len(w), len(set(w)), [mask(x) for x in w[:3]]))

# ------------------------------------------------------------------ 5.2
out("\n=== 5.2 Nilai distinct kolom K kode_bang_label (repr persis) ===")
c = Counter(KB(r) for r in rows)
for k, n in c.most_common():
    out("  %r : %d" % (k, n))
out("varian setelah strip+lower:", dict(Counter(KB(r).strip().lower() for r in rows)))

# ------------------------------------------------------------------ 5.3
out("\n=== 5.3 Validitas UUID kolom A ===")
HID = re.compile("[\u200b\u200c\u200d\ufeff\u00a0\u2007\u202f\t\r\n]")
a_nonempty = [r for r in data if r["A"] != ""]
out("baris data dengan A terisi:", len(a_nonempty), "| A kosong pada baris data:", len(data) - len(a_nonempty))
valid_exact = sum(1 for r in a_nonempty if UUID.match(r["A"]))
valid_strip = sum(1 for r in a_nonempty if UUID.match(r["A"].strip()))
out("UUID valid persis:", valid_exact, "| valid setelah strip:", valid_strip, "| tidak valid:", len(a_nonempty) - valid_strip)
out("A mengandung spasi tepi:", sum(1 for r in a_nonempty if r["A"] != r["A"].strip()),
    "| karakter tersembunyi/nbsp/zero-width:", sum(1 for r in a_nonempty if HID.search(r["A"])),
    "| mengandung huruf besar:", sum(1 for r in a_nonempty if r["A"] != r["A"].lower()),
    "| panjang != 36:", sum(1 for r in a_nonempty if len(r["A"]) != 36))
exact_ids = Counter(r["A"] for r in a_nonempty)
norm_ids = Counter(iid(r) for r in a_nonempty)
out("ID unik (persis):", len(exact_ids), "| ID unik (strip+lower):", len(norm_ids), "-> selisih akibat beda huruf/spasi:", len(exact_ids) - len(norm_ids))
bad = [r for r in a_nonempty if not UUID.match(r["A"].strip())]
out("contoh nilai A tidak valid (mask):", [mask(r["A"]) for r in bad[:5]])

# ------------------------------------------------------------------ 5.4
out("\n=== 5.4 Duplikat ID: identik penuh vs berbeda; konsistensi J & K ===")
groups = defaultdict(list)
for r in a_nonempty:
    groups[iid(r)].append(r)
multi = {k: v for k, v in groups.items() if len(v) > 1}
out("ID dengan >1 baris:", len(multi), "| total baris pada ID tsb:", sum(len(v) for v in multi.values()))
full_dup_extra = 0
ids_all_identical = 0
ids_partially_identical = 0
diff_cols = Counter()
for k, v in multi.items():
    sig = [tuple(str(r[L]).strip() for L in ALL) for r in v]
    cnt = Counter(sig)
    full_dup_extra += sum(n - 1 for n in cnt.values())
    if len(cnt) == 1:
        ids_all_identical += 1
    elif any(n > 1 for n in cnt.values()):
        ids_partially_identical += 1
    for L in ALL:
        if len({str(r[L]).strip() for r in v}) > 1:
            diff_cols[L] += 1
out("baris 'ekstra' yang identik penuh dengan baris lain pada ID sama:", full_dup_extra)
out("ID yang SEMUA barisnya identik penuh:", ids_all_identical, "| ID sebagian identik:", ids_partially_identical)
out("kolom yang berbeda antar baris pada ID sama (jumlah ID):", {"%s(%s)" % (L, COL[L]): n for L, n in sorted(diff_cols.items())})
incons_J = sum(1 for v in multi.values() if len({r["J"].strip().upper() for r in v}) > 1)
incons_K = sum(1 for v in multi.values() if len({r["K"].strip() for r in v}) > 1)
out("ID multi-baris dengan nama_kk (J) tidak konsisten:", incons_J, "| dengan kode_bang_label (K) tidak konsisten:", incons_K)
both_cat = [k for k, v in groups.items() if len({r["K"].strip() for r in v}) > 1]
out("ID yang muncul di >1 kategori K:", len(both_cat))

# ------------------------------------------------------------------ 5.5
out("\n=== 5.5 Nama usaha / pengusaha kosong per kategori; nama usaha ganda dalam ID ===")
cats = sorted({r["K"] for r in data})
for ck in cats:
    sub = [r for r in data if r["K"] == ck]
    out("  K=%r baris=%d | R(Nama Usaha) kosong=%d | S(Nama Pengusaha) kosong=%d | J(nama_kk) kosong=%d | H(nama_usaha_bang) kosong=%d | R kosong & S terisi=%d"
        % (ck, len(sub), sum(1 for r in sub if not r["R"].strip()), sum(1 for r in sub if not r["S"].strip()),
           sum(1 for r in sub if not r["J"].strip()), sum(1 for r in sub if not r["H"].strip()),
           sum(1 for r in sub if not r["R"].strip() and r["S"].strip())))


def norm_plan(s):                 # persis seperti pseudocode implementation_plan.md (upper, non-alnum -> spasi, collapse, trim)
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]", " ", str(s or "").upper())).strip()


def norm_ex(s):                   # persis seperti contoh 'update keuangan usaha prelist keluarga.js' (upper, collapse spasi, trim)
    return re.sub(r"\s+", " ", str(s or "").upper()).strip()


camp = {k: v for k, v in groups.items() if v[0]["K"].strip().startswith("2")}
dup_name_in_id = sum(1 for v in camp.values() if len([r for r in v if r["R"].strip()]) != len({norm_ex(r["R"]) for r in v if r["R"].strip()}))
out("ID Campuran dengan nama usaha (R) ganda (norm_ex sama) di ID yang sama:", dup_name_in_id)

# ------------------------------------------------------------------ 5.6
out("\n=== 5.6 Fungsi normalisasi nama pada data ===")
names_R = [r["R"] for r in data if r["R"].strip()]
names_J = [r["J"] for r in data if r["J"].strip()]
for label, names in (("Nama Usaha (R)", names_R), ("nama_kk (J)", names_J)):
    out("-- %s: n=%d" % (label, len(names)))
    out("   raw != strip:", sum(1 for s in names if s != s.strip()),
        "| spasi ganda:", sum(1 for s in names if re.search(r"\s{2,}", s)),
        "| ada huruf kecil:", sum(1 for s in names if s != s.upper()),
        "| ada non-ASCII:", sum(1 for s in names if any(ord(ch) > 127 for ch in s)),
        "| ada karakter tersembunyi:", sum(1 for s in names if HID.search(s)),
        "| ada tanda baca/simbol selain huruf/angka/spasi:", sum(1 for s in names if re.search(r"[^A-Za-z0-9\s]", s)),
        "| hanya angka:", sum(1 for s in names if s.strip().isdigit()))
    out("   hasil norm_plan kosong:", sum(1 for s in names if not norm_plan(s)), "| hasil norm_ex kosong:", sum(1 for s in names if not norm_ex(s)))
    # nama berbeda secara raw-strip-upper tetapi identik setelah norm_plan (potensi salah-cocok)
    by_plan = defaultdict(set)
    by_ex = defaultdict(set)
    for s in names:
        by_plan[norm_plan(s)].add(norm_ex(s))
        by_ex[norm_ex(s)].add(s.strip())
    coll = {k: v for k, v in by_plan.items() if len(v) > 1}
    out("   kelompok yang BERBEDA di norm_ex tetapi MENYATU di norm_plan (kolisi akibat buang simbol):", len(coll),
        "| nama yang terlibat:", sum(len(v) for v in coll.values()))
    out("   contoh kolisi (hash, bukan nama):", [[h(x) for x in sorted(v)] for v in list(coll.values())[:3]])
# kolisi dalam satu ID (dua usaha berbeda di keluarga yang sama dianggap sama oleh norm_plan?)
same_fam_coll = 0
same_fam_coll_ex = 0
for v in camp.values():
    ns = [r["R"] for r in v if r["R"].strip()]
    if len({norm_plan(x) for x in ns}) < len({norm_ex(x) for x in ns}):
        same_fam_coll += 1
    if len({norm_ex(x) for x in ns}) < len({x.strip() for x in ns}):
        same_fam_coll_ex += 1
out("ID Campuran di mana norm_plan MENYATUKAN dua nama usaha yang berbeda menurut norm_ex:", same_fam_coll,
    "| di mana norm_ex menyatukan nama beda hanya karena huruf/spasi:", same_fam_coll_ex)

# ------------------------------------------------------------------ 5.7
out("\n=== 5.7 Distribusi per SLS (kunci = kec|desa|kode_sls) ===")
sls = defaultdict(lambda: {"rows": 0, "ids": set(), "campids": set(), "campA": set(), "bku_rows": 0, "name": set()})
camp_rows_per_id = Counter(iid(r) for r in data if r["K"].strip().startswith("2") and r["A"].strip())
for r in data:
    key = (r["D"], r["E"], r["F"])
    s = sls[key]
    s["rows"] += 1
    s["name"].add(r["G"])
    if r["A"].strip():
        s["ids"].add(iid(r))
    if r["K"].strip().startswith("2") and r["A"].strip():
        s["campids"].add(iid(r))
        if camp_rows_per_id[iid(r)] == 1:
            s["campA"].add(iid(r))
    if r["K"].strip().startswith("1"):
        s["bku_rows"] += 1
out("jumlah SLS (kunci kec|desa|kode_sls):", len(sls), "| jumlah kode_sls unik saja:", len({k[2] for k in sls}), "| kode_sls unik per desa tidak menjamin unik global:", len({k[2] for k in sls}) != len(sls))
id_multi_sls = sum(1 for k in groups if len({(r["D"], r["E"], r["F"]) for r in groups[k]}) > 1)
out("ID yang muncul di >1 SLS:", id_multi_sls)
cm = sorted(((len(v["campids"]), k, v) for k, v in sls.items()), key=lambda x: x[0])
vals = [x[0] for x in cm]
out("keluarga Campuran unik per SLS: min=%d median=%s p25/p75=%s/%s max=%d | SLS tanpa keluarga Campuran: %d"
    % (min(vals), statistics.median(vals), statistics.quantiles(vals, n=4)[0], statistics.quantiles(vals, n=4)[2], max(vals), sum(1 for x in vals if x == 0)))
rowvals = sorted(v["rows"] for v in sls.values())
out("baris per SLS: min=%d median=%s max=%d" % (rowvals[0], statistics.median(rowvals), rowvals[-1]))
out("10 SLS terkecil (berisi >=1 keluarga Campuran): (Campuran unik, calon-A menurut Excel, baris, kec, desa, kode_sls, nama_sls)")
for n, k, v in [x for x in cm if x[0] > 0][:10]:
    out("   ", n, len(v["campA"]), v["rows"], k[0], k[1], k[2], "|".join(sorted(v["name"])))
out("10 SLS terbesar: (Campuran unik, calon-A menurut Excel, baris, kec, desa, kode_sls, nama_sls)")
for n, k, v in cm[::-1][:10]:
    out("   ", n, len(v["campA"]), v["rows"], k[0], k[1], k[2], "|".join(sorted(v["name"])))
band = [x for x in cm if 20 <= x[0] <= 40]
out("SLS dengan 20-40 keluarga Campuran unik:", len(band))
out("  rasio calon-A (1 baris Excel / semua) per SLS pada SLS>=20 keluarga: min/median/max =",
    "%.3f / %.3f / %.3f" % ((lambda xs: (min(xs), statistics.median(xs), max(xs)))([len(v["campA"]) / len(v["campids"]) for n, k, v in cm if n >= 20])))
big = [len(v["campA"]) / len(v["campids"]) for n, k, v in cm if n >= 20]
out("  SLS>=20: n=%d, stdev rasio=%.3f" % (len(big), statistics.pstdev(big)))
small = [len(v["campA"]) / len(v["campids"]) for n, k, v in cm if 0 < n < 20]
out("  SLS<20: n=%d, rasio min/median/max = %.3f / %.3f / %.3f" % (len(small), min(small), statistics.median(small), max(small)))

# ------------------------------------------------------------------ 5.8
out("\n=== 5.8 Rekonsiliasi total ===")
out("baris data:", len(data), "| baris kosong:", len(blank), "| total baris XML:", len(rows))
ids_all = {iid(r) for r in data if r["A"].strip()}
out("ID unik:", len(ids_all))
rc = Counter(r["K"].strip() for r in data)
out("baris per K:", dict(rc))
for ck in sorted(rc):
    ids = {iid(r) for r in data if r["K"].strip() == ck and r["A"].strip()}
    out("  K=%r baris=%d ID unik=%d" % (ck, rc[ck], len(ids)))
out("baris data dengan ID kosong:", sum(1 for r in data if not r["A"].strip()), "| baris data dengan K kosong:", sum(1 for r in data if not r["K"].strip()))
out("baris kosong yang punya A terisi:", sum(1 for r in blank if r["A"].strip()), "(harus 0)")
out("Cek: 9075 = %d ; 8498 = %d ; 3155/2637 ; 5920/5861 ; 183 = %d" % (len(data), len(ids_all), len(blank)))

# ------------------------------------------------------------------ 5.9 bahan
out("\n=== 5.9 Bahan: apa arti '1 baris Excel per ID' ===")
c1 = [k for k, v in camp.items() if len(v) == 1]
c1_ok = [k for k in c1 if camp[k][0]["R"].strip() and camp[k][0]["J"].strip()]
out("Campuran 1 baris:", len(c1), "| dengan R & J terisi (kandidat-A maks. menurut Excel):", len(c1_ok), "| R kosong:", sum(1 for k in c1 if not camp[k][0]["R"].strip()), "| J kosong:", sum(1 for k in c1 if not camp[k][0]["J"].strip()))
cm_rows = [len(v) for v in camp.values()]
out("jumlah baris per ID Campuran:", dict(Counter(cm_rows)))
out("pengusaha (S) berbeda antar baris pada ID multi-baris Campuran:", sum(1 for v in camp.values() if len(v) > 1 and len({norm_ex(r["S"]) for r in v}) > 1), "dari", sum(1 for v in camp.values() if len(v) > 1))
out("nama usaha (R) berbeda antar baris pada ID multi-baris Campuran:", sum(1 for v in camp.values() if len(v) > 1 and len({norm_ex(r["R"]) for r in v}) > 1))
out("kolom H nama_usaha_bang terisi pada Campuran:", sum(1 for v in camp.values() for r in v if r["H"].strip()), "| H sama dengan R (norm_ex):", sum(1 for v in camp.values() for r in v if r["H"].strip() and norm_ex(r["H"]) == norm_ex(r["R"])))
out("kolom P Petugas terisi:", sum(1 for r in data if str(r["P"]).strip()), "| Q Kode Identifier terisi:", sum(1 for r in data if r["Q"].strip()), "| distinct Q:", len({r["Q"].strip() for r in data if r["Q"].strip()}))

with open("evidence/r5_output.txt", "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
