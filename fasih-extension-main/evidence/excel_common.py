"""READ-ONLY loader untuk salinan 'Target Penyisiran Slawi.xlsx' (stdlib saja).

Tidak menulis ke berkas Excel. Tidak mencetak data pribadi: gunakan mask()/h()
untuk nilai yang bersifat identitas (nama KK, nama usaha, nama pengusaha, alamat, NIK).
"""
import hashlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

COPY = r"C:\Users\ating\.gemini\antigravity-ide\brain\269a922d-34a7-40e8-a158-c0e309afb04e\scratch\excel_copy\target_copy.xlsx"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SALT = "t01-evidence"


def h(v):
    """hash pendek, tidak dapat dibalik secara praktis, untuk membandingkan tanpa membuka nilai"""
    return hashlib.sha256((SALT + str(v)).encode("utf-8")).hexdigest()[:8]


def mask(v):
    s = str(v or "")
    return "" if not s else "<%d ch #%s>" % (len(s), h(s))


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def L_of(i):
    s = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(65 + rem) + s
    return s


# peta kolom (huruf) -> nama; huruf dipakai sebagai kunci karena header M/T, N/U, O/V kembar
COL = dict(A="assignment_id", B="geotag_latitude", C="geotag_longitude", D="kec", E="desa", F="kode_sls",
           G="nama_sls", H="nama_usaha_bang", I="no_bang", J="nama_kk", K="kode_bang_label", L="catatan",
           M="JK_label(1)", N="umur(1)", O="nik_pengusaha(1)", P="Petugas", Q="Kode Identifier",
           R="Nama Usaha", S="Nama Pengusaha", T="JK_label(2)", U="umur(2)", V="nik_pengusaha(2)", W="(header kosong)")


def load(path=COPY):
    """return (header:list[str], rows:list[dict], meta:dict). rows menyimpan nilai mentah (str) per header,
    plus '_r' = nomor baris Excel (1-based)."""
    with zipfile.ZipFile(path, "r") as z:
        ss = []
        if "xl/sharedStrings.xml" in z.namelist():
            t = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in t.findall(NS + "si"):
                ss.append("".join(x.text or "" for x in si.iter(NS + "t")))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    raw = []
    for row in sheet.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            ref = c.attrib.get("r", "")
            letters = "".join(ch for ch in ref if ch.isalpha())
            t = c.attrib.get("t", "")
            v = c.find(NS + "v")
            if t == "inlineStr":
                is_ = c.find(NS + "is")
                val = "".join(x.text or "" for x in is_.iter(NS + "t")) if is_ is not None else ""
            elif v is not None and v.text is not None:
                val = ss[int(v.text)] if t == "s" else v.text
            else:
                val = ""
            cells[col_index(letters)] = (val, t)
        raw.append((int(row.attrib.get("r", "0")), cells))
    hdr_r, hdr_cells = raw[0]
    width = max(hdr_cells) + 1
    header = [hdr_cells.get(i, ("", ""))[0] for i in range(width)]
    rows = []
    types = {}
    for r, cells in raw[1:]:
        d = {"_r": r}
        for i in range(width):
            val, t = cells.get(i, ("", ""))
            L = L_of(i)
            d[L] = val                      # kunci = HURUF KOLOM (nama header ada yang ganda)
            if val != "":
                types.setdefault(L, set()).add(t or "n")
        rows.append(d)
    meta = {"header_row": hdr_r, "width": width, "n_xml_rows_after_header": len(rows), "types": types}
    return header, rows, meta


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    header, rows, meta = load()
    print("header (urut kolom):", list(enumerate(header)))
    print("meta:", {k: v for k, v in meta.items() if k != "types"})
    print("tipe sel per huruf kolom (s=shared string, n=numerik, str=formula string):")
    for L, t in sorted(meta["types"].items(), key=lambda x: (len(x[0]), x[0])):
        print(" ", L, COL.get(L, "?"), sorted(t))
