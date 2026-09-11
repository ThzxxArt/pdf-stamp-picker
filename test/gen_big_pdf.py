#!/usr/bin/env python3
"""生成一个体积较大的合法 PDF（用于验证大文件哈希路径）。
不依赖第三方库，手写 PDF 结构：N 页，每页一段文本 + 大填充流。
"""
import sys

def build_pages(n, pad_bytes):
    objs = {}
    page_ids = []
    # 1 = Catalog, 2 = Pages, 3 = Font
    content_ids = []
    next_id = 4
    for i in range(n):
        content_ids.append(next_id); next_id += 1
        page_ids.append(next_id); next_id += 1

    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objs[2] = f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode()
    objs[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    pad = b"%" + b"P" * pad_bytes + b"\n"
    for i in range(n):
        cid, pid = content_ids[i], page_ids[i]
        stream = (b"BT /F1 24 Tf 72 700 Td (Page %d) Tj ET\n" % (i + 1)) + pad
        objs[cid] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        objs[pid] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                     f"/Resources << /Font << /F1 3 0 R >> >> /Contents {cid} 0 R >>").encode()

    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for oid in sorted(objs):
        offsets[oid] = len(out)
        out += f"{oid} 0 obj\n".encode() + objs[oid] + b"\nendobj\n"
    xref_pos = len(out)
    max_id = max(objs)
    out += f"xref\n0 {max_id + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for oid in range(1, max_id + 1):
        out += f"{offsets.get(oid, 0):010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {max_id + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n").encode()
    return bytes(out)

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "big.pdf"
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    pad = int(sys.argv[3]) if len(sys.argv) > 3 else 70000
    data = build_pages(pages, pad)
    with open(path, "wb") as f:
        f.write(data)
    print(f"{path}: {len(data)} bytes, {pages} pages")
