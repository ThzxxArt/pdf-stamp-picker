#!/usr/bin/env python3
"""生成测试 PDF：3 页，含 /Rotate 90 旋转页，验证签章坐标选择器的旋转补偿。"""
import zlib

def esc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if o < 32 or o > 126 or ch in '()\\':
            out.append('\\%03o' % o)
        else:
            out.append(ch)
    return ''.join(out)

def build_pdf():
    objs = []
    def add(data):
        objs.append(data)
        return len(objs)

    # ---- 内容流 ----
    def stream(content):
        return b'<< /Length %d >>\nstream\n%s\nendstream' % (len(content), content)

    # 页1: A4 竖版 595.28 x 841.89
    s1 = b'''
q
0.85 0.87 0.92 rg
0 0 595.28 841.89 re f
0.1 0.1 0.1 RG 1 w
0.5 0.5 595.28-1 841.89-1 re S
BT /F1 20 Tf 0.15 0.3 0.55 rg 40 780 Td (PDF Stamp Position Picker - Demo Page 1) Tj ET
BT /F1 10 Tf 0.3 0.3 0.3 rg 40 755 Td (A4 portrait. Draw a selection where a seal should be placed.) Tj ET
0.9 0.95 1 rg 0.35 0.55 0.9 RG 1.2 w
120 500 200 120 re B
0.25 0.55 0.9 rg
140 540 160 8 re f
BT /F1 9 Tf 1 1 1 rg 150 542 Td (SEAL HERE) Tj ET
0.75 0.55 0.35 RG
360 300 150 60 re S
BT /F1 9 Tf 0.45 0.3 0.2 rg 375 322 Td (signature line) Tj ET
Q
'''
    s2 = b'''
q
0.92 0.88 0.85 rg
0 0 595.28 841.89 re f
0.6 0.2 0.2 RG 1.5 w
0.5 0.5 595.28-1 841.89-1 re S
BT /F1 24 Tf 0.65 0.2 0.2 rg 60 400 Td (THIS PAGE IS ROTATED 90 DEGREES) Tj ET
BT /F1 10 Tf 0.4 0.2 0.2 rg 60 370 Td (The picker must compensate rotation and report PDF-native coordinates.) Tj ET
0.85 0.3 0.3 rg
200 300 260 90 re f
BT /F1 12 Tf 1 1 1 rg 220 345 Td (ROTATED SEAL AREA) Tj ET
Q
'''
    s3 = b'''
q
0.94 0.94 0.9 rg
0 0 612 792 re f
0.2 0.2 0.2 RG 1 w
0.5 0.5 612-1 792-1 re S
BT /F1 16 Tf 0.2 0.35 0.5 rg 50 720 Td (Page 3 - US Letter size 612x792 pt) Tj ET
0.3 0.5 0.7 rg
450 100 120 60 re f
BT /F1 8 Tf 1 1 1 rg 465 125 Td (STAMP) Tj ET
Q
'''
    c1 = stream(s1); c2 = stream(s2); c3 = stream(s3)
    id_c1 = add(c1); id_c2 = add(c2); id_c3 = add(c3)

    f1 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    f2 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
    f3 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>')
    f4 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>')

    res = add(b'<< /Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R /F4 %d 0 R >> >>' % (f1, f2, f3, f4))

    p1 = add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.28 841.89] /Resources %d 0 R /Contents %d 0 R >>' % (0, res, id_c1))
    p2 = add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.28 841.89] /Rotate 90 /Resources %d 0 R /Contents %d 0 R >>' % (0, res, id_c2))
    p3 = add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Resources %d 0 R /Contents %d 0 R >>' % (0, res, id_c3))

    kids = add(b'<< /Type /Pages /Kids [%d 0 R %d 0 R %d 0 R] /Count 3 >>' % (p1, p2, p3))
    catalog = add(b'<< /Type /Catalog /Pages %d 0 R >>' % kids)

    # 修正 parent 引用
    objs[p1 - 1] = b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.28 841.89] /Resources %d 0 R /Contents %d 0 R >>' % (kids, res, id_c1)
    objs[p2 - 1] = b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.28 841.89] /Rotate 90 /Resources %d 0 R /Contents %d 0 R >>' % (kids, res, id_c2)
    objs[p3 - 1] = b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Resources %d 0 R /Contents %d 0 R >>' % (kids, res, id_c3)

    out = [b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n']
    offsets = [0]
    for i, o in enumerate(objs):
        offsets.append(len(b''.join(out)))
        out.append(b'%d 0 obj\n' % (i + 1))
        out.append(o if isinstance(o, bytes) else str(o).encode())
        out.append(b'\nendobj\n')

    xref_pos = len(b''.join(out))
    n = len(objs)
    out.append(b'xref\n0 %d\n0000000000 65535 f \n' % (n + 1))
    for off in offsets[1:]:
        out.append(b'%010d 00000 n \n' % off)
    out.append(b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (n + 1, catalog, xref_pos))
    return b''.join(out)

data = build_pdf()
with open('/var/minis/workspace/pdf-stamp-picker/demo/test.pdf', 'wb') as f:
    f.write(data)
print('test.pdf 生成成功:', len(data), 'bytes, 3 页 (含 /Rotate 90 页)')
