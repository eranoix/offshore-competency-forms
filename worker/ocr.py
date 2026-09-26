#!/usr/bin/env python3
"""Read the scans in the Offshore Report library with tesseract and store their words.

Deliberately not docling: that engine is shared with other work and takes
minutes and gigabytes on a scan that tesseract reads in four seconds.
"""
import json, os, re, subprocess, sys, tempfile, urllib.parse, zipfile

BASE = "http://127.0.0.1:8000"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = ["-H", f"apikey: {KEY}", "-H", f"authorization: Bearer {KEY}"]
MAX_PAGES = 12
BATCH = int(os.environ.get("OCR_BATCH", "8"))


def rest(method, path, body=None, extra=()):
    cmd = ["curl", "-s", "-X", method, f"{BASE}/rest/v1/{path}", *H,
           "-H", "content-type: application/json", *extra]
    if body is not None:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(body, f)
            tmp = f.name
        cmd += ["--data-binary", f"@{tmp}"]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    if body is not None:
        os.unlink(tmp)
    return out


def fetch(path, dest):
    code = subprocess.run(["curl", "-s", "-o", dest, "-w", "%{http_code}",
                           f"{BASE}/storage/v1/object/offshore-report-library/{urllib.parse.quote(path)}", *H],
                          capture_output=True, text=True).stdout.strip()
    return code == "200"


def from_office(path):
    """Word and Excel keep their words in one part of a zip."""
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if "word/document.xml" in names:
                xml = z.read("word/document.xml").decode("utf-8", "replace")
                xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
                xml = re.sub(r"</w:p>", "\n", xml)
            elif "xl/sharedStrings.xml" in names:
                xml = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
                xml = re.sub(r"</si>", "\n", xml)
            else:
                return ""
    except Exception:
        return ""
    text = re.sub(r"<[^>]+>", "", xml)
    for a, b in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&")):
        text = text.replace(a, b)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def from_old_word(path):
    """A binary .doc: pull the runs of readable text out of it."""
    raw = open(path, "rb").read()
    words = re.findall(rb"[\x20-\x7e]{6,}", raw)
    text = "\n".join(w.decode("ascii", "replace") for w in words)
    # the tail of a .doc is full of style and font names; keep the sentences
    keep = [l for l in text.splitlines() if len(l.split()) >= 4]
    return "\n".join(keep).strip()


def words_in(path, kind):
    """Whatever this file is, the words in it — or nothing, honestly."""
    low = path.lower()
    if kind == "application/pdf" or low.endswith(".pdf"):
        return ocr(path, kind)
    if low.endswith((".docx", ".docm", ".xlsx", ".pptx")) or "openxmlformats" in kind or "ms-word.document" in kind:
        return from_office(path)
    if kind == "application/msword" or low.endswith(".doc"):
        return from_old_word(path)
    if kind.startswith("image/"):
        return ocr(path, kind)
    return ""


def ocr(path, kind):
    """The words on the page, whether it arrived as a PDF or as a photograph."""
    with tempfile.TemporaryDirectory() as tmp:
        if kind == "application/pdf" or path.lower().endswith(".pdf"):
            subprocess.run(["pdftoppm", "-r", "250", "-png", "-l", str(MAX_PAGES),
                            path, os.path.join(tmp, "p")], check=False, timeout=600)
            pages = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
        else:
            pages = [os.path.basename(path)]
            tmp = os.path.dirname(path)
        out = []
        for page in pages:
            r = subprocess.run(["tesseract", os.path.join(tmp, page), "-", "--psm", "6"],
                               capture_output=True, text=True, timeout=300)
            out.append(r.stdout)
        return "\n\n".join(out).strip()


def markdown(raw):
    seen, lines = set(), []
    for line in raw.splitlines():
        t = " ".join(line.split())
        if len(t) < 3 or re.fullmatch(r"[-_=.·•\s|]+", t) or re.fullmatch(r"page \d+ of \d+|\d+", t, re.I):
            continue
        if len(t) < 60 and t in seen:
            continue
        seen.add(t)
        lines.append(f"\n## {t}" if t.isupper() and len(t) < 80 else t)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def passages(text, size=1200):
    out, buf = [], ""
    for line in markdown(text).split("\n"):
        if len(buf) + len(line) + 1 > size and buf:
            out.append(buf.strip())
            buf = ""
        buf += line + "\n"
    if buf.strip():
        out.append(buf.strip())
    return [p for p in out if len(p) > 140][:80]


def main():
    rows = json.loads(rest(
        "GET",
        "offshore_report_library?select=id,user_id,name,kind,path&text_content=is.null"
        f"&order=created_at.asc&limit={BATCH}"))
    if not rows:
        print("nothing to read")
        return 0
    read = 0
    for row in rows:
        ext = os.path.splitext(row["path"])[1] or ".bin"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            local = f.name
        try:
            if not fetch(row["path"], local):
                print("could not fetch", row["name"][:50]); continue
            text = words_in(local, row["kind"] or "")
            parts = passages(text)
            # A page with nothing on it is marked read, not tried again forever.
            rest("PATCH", f"offshore_report_library?id=eq.{row['id']}",
                 {"text_content": text[:200000] if text else ""},
                 extra=("-H", "prefer: return=minimal"))
            if parts:
                rest("POST", "offshore_report_library_chunks",
                     [{"user_id": row["user_id"], "doc_id": row["id"], "ord": i, "text": p}
                      for i, p in enumerate(parts)],
                     extra=("-H", "prefer: return=minimal"))
                read += 1
            print(f"{row['name'][:46]:<46} {len(text):>6} chars  {len(parts):>2} passages")
        finally:
            os.path.exists(local) and os.unlink(local)
    print(f"read {read} of {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
