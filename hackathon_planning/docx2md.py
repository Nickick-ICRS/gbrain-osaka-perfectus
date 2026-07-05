#!/usr/bin/env python3
"""Minimal stdlib .docx -> Markdown converter (headings, lists, tables, paragraphs)."""
import sys, os, re, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

def text_of(el):
    """Concatenate all w:t runs, honour tabs/breaks."""
    out = []
    for node in el.iter():
        if node.tag == W + "t":
            out.append(node.text or "")
        elif node.tag == W + "tab":
            out.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            out.append(" ")
    return "".join(out).strip()

def para_md(p):
    ppr = p.find(W + "pPr")
    style = ""
    is_list = False
    if ppr is not None:
        st = ppr.find(W + "pStyle")
        if st is not None:
            style = st.get(W + "val", "") or ""
        if ppr.find(W + "numPr") is not None:
            is_list = True
    txt = text_of(p)
    if not txt:
        return ""
    s = style.lower()
    if "title" in s:
        return f"# {txt}"
    m = re.search(r"heading(\d)", s)
    if m:
        lvl = min(int(m.group(1)) + 1, 6)   # Heading1 -> ## (keep one #-level for doc title)
        return f"{'#'*lvl} {txt}"
    if is_list or "listparagraph" in s:
        return f"- {txt}"
    return txt

def table_md(tbl):
    rows = []
    for tr in tbl.findall(W + "tr"):
        cells = []
        for tc in tr.findall(W + "tc"):
            cell = " ".join(text_of(p) for p in tc.findall(W + "p") if text_of(p))
            cells.append(cell.replace("|", "\\|").replace("\n", " "))
        if any(c.strip() for c in cells):
            rows.append(cells)
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * ncol) + " |"]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)

def convert(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    body = ET.fromstring(xml).find(W + "body")
    parts, blank = [], False
    for child in list(body):
        if child.tag == W + "p":
            md = para_md(child)
        elif child.tag == W + "tbl":
            md = table_md(child)
        else:
            continue
        if md:
            parts.append(md)
            blank = False
        elif not blank:
            parts.append("")   # collapse runs of empties into one blank line
            blank = True
    return re.sub(r"\n{3,}", "\n\n", "\n\n".join(parts).strip()) + "\n"

if __name__ == "__main__":
    outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)
    for src in sys.argv[2:]:
        base = os.path.splitext(os.path.basename(src))[0]
        slug = re.sub(r"[^A-Za-z0-9]+", "_", base).strip("_")
        dst = os.path.join(outdir, slug + ".md")
        md = convert(src)
        with open(dst, "w") as f:
            f.write(md)
        print(f"{os.path.basename(src)}  ->  {os.path.basename(dst)}  ({len(md)} chars, {md.count(chr(10))+1} lines)")
