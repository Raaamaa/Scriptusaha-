"""Analisis Profil Kolom Excel Khusus Bangunan Campuran (READ-ONLY).
Memenuhi permintaan Poin 4:
- Persentase terisi SETIAP kolom (A..W) pada Bangunan Campuran (3.155 baris, 2.637 keluarga).
- Dipisah: keluarga 1-baris (2.186 keluarga/baris) vs multi-baris (451 keluarga, 969 baris).
- Analisis khusus untuk 1.887 keluarga Campuran dengan Kolom R kosong.
- Tanpa menampilkan data pribadi (hanya statistik & hitungan).
"""
import io
import sys
from collections import defaultdict
from excel_common import COL, load

sys.stdout.reconfigure(encoding="utf-8")
BUF = io.StringIO()

def out(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    BUF.write(s + "\n")

header, rows, meta = load()
ALL = list(COL)

# Filter hanya Bangunan Campuran
campuran_rows = [r for r in rows if str(r["K"]).strip() == "2. Bangunan Campuran"]
out(f"=== Total Baris Bangunan Campuran: {len(campuran_rows)} ===")

# Kelompokkan per keluarga (assignment_id)
by_id = defaultdict(list)
for r in campuran_rows:
    by_id[r["A"].strip().lower()].append(r)

out(f"=== Total Keluarga Unik Campuran: {len(by_id)} ===")

single_rows = []
multi_rows = []
for iid, rlist in by_id.items():
    if len(rlist) == 1:
        single_rows.extend(rlist)
    else:
        multi_rows.extend(rlist)

out(f"Keluarga 1-baris: {len(by_id) - sum(1 for v in by_id.values() if len(v) > 1)} keluarga ({len(single_rows)} baris)")
out(f"Keluarga multi-baris: {sum(1 for v in by_id.values() if len(v) > 1)} keluarga ({len(multi_rows)} baris)")

out("\n=== 1. PERSENTASE TERISI SETIAP KOLOM (A..W) ===")
out(f"{'Kolom':<6} {'Nama Header':<22} {'Semua (3155)':<16} {'1-Baris (2186)':<16} {'Multi (969)':<16}")
out("-" * 80)

def is_filled(val):
    return str(val).strip() != ""

for c in ALL:
    hname = COL[c]
    n_all = sum(1 for r in campuran_rows if is_filled(r[c]))
    pct_all = (n_all / len(campuran_rows)) * 100

    n_single = sum(1 for r in single_rows if is_filled(r[c]))
    pct_single = (n_single / len(single_rows)) * 100

    n_multi = sum(1 for r in multi_rows if is_filled(r[c]))
    pct_multi = (n_multi / len(multi_rows)) * 100

    out(f"{c:<6} {hname:<22} {n_all:>5} ({pct_all:>5.1f}%)    {n_single:>5} ({pct_single:>5.1f}%)    {n_multi:>5} ({pct_multi:>5.1f}%)")

out("\n=== 2. ANALISIS KHUSUS 1.887 KELUARGA 1-BARIS DENGAN KOLOM R KOSONG ===")
r_empty_singles = [r for r in single_rows if not is_filled(r["R"])]
out(f"Total baris/keluarga 1-baris dengan Kolom R kosong: {len(r_empty_singles)}")

out(f"{'Kolom':<6} {'Nama Header':<22} {'Terisi':<10} {'Persentase':<12}")
out("-" * 52)
for c in ALL:
    hname = COL[c]
    n = sum(1 for r in r_empty_singles if is_filled(r[c]))
    pct = (n / len(r_empty_singles)) * 100
    out(f"{c:<6} {hname:<22} {n:>5}      {pct:>5.1f}%")

out("\n=== 3. POLA KOMBINASI KOLOM TERISI PADA 1.887 KELUARGA KOLOM R KOSONG ===")
combo_counter = defaultdict(int)
for r in r_empty_singles:
    filled_cols = "".join(c for c in ALL if is_filled(r[c]))
    combo_counter[filled_cols] += 1

out(f"Jumlah variasi pola kolom: {len(combo_counter)}")
for combo, cnt in sorted(combo_counter.items(), key=lambda x: x[1], reverse=True)[:10]:
    out(f"  Pola: {combo:<24} Jumlah: {cnt:>5} ({cnt/len(r_empty_singles)*100:>5.1f}%)")

out("\n=== 4. ANALISIS KOLOM IDENTIFIER ALTERNATIF ===")
out("Apakah ada kolom no telepon, email, KBLI, atau alamat spesifik?")
out(f"  Kolom H (nama_usaha_bang): terisi pada Campuran = {sum(1 for r in campuran_rows if is_filled(r['H']))}")
out(f"  Kolom Q (Kode Identifier): terisi pada Campuran = {sum(1 for r in campuran_rows if is_filled(r['Q']))}")
out(f"  Kolom S (Nama Pengusaha) : terisi pada Campuran = {sum(1 for r in campuran_rows if is_filled(r['S']))}")
out(f"  Kolom W (header kosong)  : terisi pada Campuran = {sum(1 for r in campuran_rows if is_filled(r['W']))}")
out(f"  Kolom P (Petugas)        : terisi pada Campuran = {sum(1 for r in campuran_rows if is_filled(r['P']))}")

# Simpan ke file evidence
with open("evidence/r4_campuran_output.txt", "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
out("\nHasil disimpan ke evidence/r4_campuran_output.txt")
