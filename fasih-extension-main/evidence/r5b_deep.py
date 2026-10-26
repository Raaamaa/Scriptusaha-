"""R5 lanjutan (READ-ONLY, salinan Excel): kedalaman interpretasi baris-per-ID. Keluaran: evidence/r5b_output.txt
Tanpa data pribadi (hanya hitungan/hash; label kategori hanya bila frekuensi >= 30).
"""
import io
import re
import statistics
import sys
from collections import Counter, defaultdict
from excel_common import COL, h, load

sys.stdout.reconfigure(encoding="utf-8")
BUF = io.StringIO()


def out(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    BUF.write(s + "\n")


header, rows, meta = load()
ALL = list(COL)
data = [r for r in rows if any(str(r[c]).strip() for c in ALL)]
iid = lambda r: r["A"].strip().lower()
norm_ex = lambda s: re.sub(r"\s+", " ", str(s or "").upper()).strip()
sig = lambda r: tuple(str(r[L]).strip() for L in ALL)

camp_rows = [r for r in data if r["K"].strip().startswith("2")]
g = defaultdict(list)
for r in camp_rows:
    g[iid(r)].append(r)
out("=== B1. ID Campuran:", len(g), "| baris:", len(camp_rows))

# a. jumlah baris DISTINCT (signature penuh) per ID
dist = Counter(len(set(sig(r) for r in v)) for v in g.values())
out("jumlah baris DISTINCT (semua kolom A..W identik dianggap 1) per ID Campuran:", dict(sorted(dist.items())))
rn = Counter(len({norm_ex(r["R"]) for r in v if r["R"].strip()}) for v in g.values())
out("jumlah nama usaha (R) DISTINCT non-kosong per ID Campuran:", dict(sorted(rn.items())))

# b. aturan kandidat-A menurut Excel saja
def one_row(v): return len(v) == 1
def one_distinct(v): return len(set(sig(r) for r in v)) == 1
def has_names(v): return all(r["R"].strip() and r["J"].strip() for r in v)
rule = {
    "R1 plan apa adanya: tepat 1 baris Excel & R,J terisi": sum(1 for v in g.values() if one_row(v) and has_names(v)),
    "R2 1 baris distinct (duplikat identik dilebur) & R,J terisi": sum(1 for v in g.values() if one_distinct(v) and has_names(v)),
    "R3 tepat 1 nama usaha (R) distinct & J terisi": sum(1 for v in g.values() if len({norm_ex(r['R']) for r in v if r['R'].strip()}) == 1 and all(r['J'].strip() for r in v)),
    "R4 tepat 1 baris Excel saja (abaikan R)": sum(1 for v in g.values() if one_row(v)),
    "R5 1 baris distinct saja (abaikan R)": sum(1 for v in g.values() if one_distinct(v)),
}
for k, n in rule.items():
    out("  %-70s %5d  (%.1f%% dari %d ID Campuran)" % (k, n, 100 * n / len(g), len(g)))
no_R_any = sum(1 for v in g.values() if not any(r["R"].strip() for r in v))
out("ID Campuran TANPA nama usaha di baris mana pun:", no_R_any, "| dengan >=1 nama usaha:", len(g) - no_R_any)

# c. baris Campuran: pola kolom terisi
out("\n=== B2. Pola isian kolom pada baris Campuran (n=%d) ===" % len(camp_rows))
pat = Counter()
for r in camp_rows:
    pat["".join(L for L in "JMNOQRSTUVW" if str(r[L]).strip())] += 1
out("pola huruf kolom terisi (J M N O Q R S T U V W) -> jumlah baris (10 teratas):", pat.most_common(10))
out("baris Campuran dengan R kosong tetapi pasangan (M/N/O atau T/U/V) terisi:", sum(1 for r in camp_rows if not r["R"].strip() and any(r[L].strip() for L in "MNOTUV")))
out("baris Campuran dengan Q terisi:", sum(1 for r in camp_rows if r["Q"].strip()), "| R terisi:", sum(1 for r in camp_rows if r["R"].strip()), "| keduanya:", sum(1 for r in camp_rows if r["Q"].strip() and r["R"].strip()))
out("baris BKU dengan Q terisi:", sum(1 for r in data if r["K"].strip().startswith("1") and r["Q"].strip()))
out("baris Campuran dengan J kosong:", sum(1 for r in camp_rows if not r["J"].strip()), "(ID unik:", len({iid(r) for r in camp_rows if not r["J"].strip()}), ")")

# d. kolom catatan, W, P
cat = Counter(r["L"].strip() for r in data if r["L"].strip())
out("\n=== B3. Kolom L 'catatan': terisi=%d, distinct=%d. Label berfrekuensi >=30 (kategori, bukan PII): ===" % (sum(cat.values()), len(cat)))
for k, n in cat.most_common():
    if n >= 30:
        out("   %r : %d" % (k[:80], n))
out("   catatan terisi menurut K: ", dict(Counter(r["K"].strip() for r in data if r["L"].strip())))
wv = [r["W"].strip() for r in data if r["W"].strip()]
out("kolom W: panjang distinct:", dict(Counter(len(x) for x in wv)), "| semua digit:", sum(1 for x in wv if x.isdigit()), "| menurut K:", dict(Counter(r["K"].strip() for r in data if r["W"].strip())))
out("kolom P Petugas: distinct =", len({str(r["P"]).strip() for r in data if str(r["P"]).strip()}), "| terisi menurut K:", dict(Counter(r["K"].strip() for r in data if str(r["P"]).strip())))
out("kolom M/T JK_label & N/U umur & O/V NIK terisi menurut K:",
    {L: dict(Counter(r["K"].strip()[:1] for r in data if str(r[L]).strip())) for L in "MNOTUV"})

# e. duplikat: kontigu di sheet?
pos = defaultdict(list)
for i, r in enumerate(data):
    pos[iid(r)].append(i)
cont = sum(1 for p in pos.values() if len(p) > 1 and p == list(range(p[0], p[0] + len(p))))
multi_pos = [p for p in pos.values() if len(p) > 1]
out("\n=== B4. Posisi duplikat di sheet ===")
out("ID multi-baris (semua kategori):", len(multi_pos), "| baris-barisnya BERURUTAN (kontigu):", cont, "| tersebar:", len(multi_pos) - cont)
gaps = [max(p) - min(p) for p in multi_pos]
out("rentang jarak baris pertama-terakhir per ID multi: min/median/max =", min(gaps), statistics.median(gaps), max(gaps))
cm_pos = [p for k, p in pos.items() if k in g and len(p) > 1]
out("ID Campuran multi-baris:", len(cm_pos), "| kontigu:", sum(1 for p in cm_pos if p == list(range(p[0], p[0] + len(p)))))
extras = sum(len(p) - 1 for p in cm_pos)
out("baris Campuran 'kemunculan ke-2 dst' (akan melihat dokumen yang sudah diubah pada LIVE, tetapi dokumen asli pada DRY RUN):", extras)

# f. berapa baris Campuran yang akan lolos Layer-1 plan (R & J terisi) -> status dasar
l1_pass = [r for r in camp_rows if r["R"].strip() and r["J"].strip()]
out("\n=== B5. Dampak Layer-1 plan (nama_usaha & nama_kk wajib terisi) pada baris Campuran ===")
out("baris lolos:", len(l1_pass), "(%.1f%%)" % (100 * len(l1_pass) / len(camp_rows)), "| baris LEWATI di Layer-1:", len(camp_rows) - len(l1_pass), "(%.1f%%)" % (100 * (len(camp_rows) - len(l1_pass)) / len(camp_rows)))

with open("evidence/r5b_output.txt", "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
