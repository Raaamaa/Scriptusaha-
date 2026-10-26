"""R5.7 lanjutan: usulan ukuran batch pertama berdasarkan kandidat bernama (aturan R3). READ-ONLY. Keluaran: evidence/r5c_output.txt"""
import io
import re
import statistics
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
data = [r for r in rows if any(str(r[c]).strip() for c in ALL)]
iid = lambda r: r["A"].strip().lower()
norm_ex = lambda s: re.sub(r"\s+", " ", str(s or "").upper()).strip()
camp = defaultdict(list)
for r in data:
    if r["K"].strip().startswith("2"):
        camp[iid(r)].append(r)


def cand(v):   # aturan R3: tepat 1 nama usaha distinct & nama_kk terisi
    return len({norm_ex(r["R"]) for r in v if r["R"].strip()}) == 1 and all(r["J"].strip() for r in v)


by_desa = defaultdict(lambda: [0, 0, 0])
by_sls = defaultdict(lambda: [0, 0])
for k, v in camp.items():
    r = v[0]
    d = (r["D"], r["E"])
    by_desa[d][0] += 1
    by_desa[d][1] += 1 if cand(v) else 0
    by_desa[d][2] += 1 if len(v) == 1 else 0
    s = (r["D"], r["E"], r["F"])
    by_sls[s][0] += 1
    by_sls[s][1] += 1 if cand(v) else 0
out("Per desa/kelurahan: (kec, desa) -> [ID Campuran, kandidat-bernama R3, ID 1-baris-Excel]")
for d, v in sorted(by_desa.items(), key=lambda x: x[1][1]):
    out("  ", d, v)
cv = sorted(v[1] for v in by_sls.values())
out("\nKandidat-bernama per SLS (hanya SLS dengan Campuran): n SLS=%d, jumlah SLS dengan >=1 kandidat=%d, max=%d, median(kandidat>0)=%s"
    % (len(cv), sum(1 for x in cv if x > 0), max(cv), statistics.median([x for x in cv if x > 0])))
out("SLS dengan >=10 kandidat:", sum(1 for x in cv if x >= 10), "| >=5:", sum(1 for x in cv if x >= 5), "| >=3:", sum(1 for x in cv if x >= 3))
out("total kandidat-bernama (R3):", sum(cv))
with open("evidence/r5c_output.txt", "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
