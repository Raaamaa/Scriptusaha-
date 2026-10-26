"""R3 (bukti web/kode publik): cari tempat 'enable' dipakai & fungsi ekspor di sumber FormGear upstream (read-only).
Sumber diunduh dari https://github.com/bps-statistics/form-gear (branch main, akses 2026-10-23) ke folder scratch.
Pemakaian: python r3_grep_formgear.py <dir> <berkas> <regex>
"""
import os
import re
import sys

d, f, rx = sys.argv[1], sys.argv[2], sys.argv[3]
sys.stdout.reconfigure(encoding="utf-8")
lines = open(os.path.join(d, f), encoding="utf-8").read().split("\n")
for i, l in enumerate(lines, 1):
    if re.search(rx, l):
        print(i, l.strip()[:170])
