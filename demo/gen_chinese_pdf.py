#!/usr/bin/env python3
"""生成带中文 CID 字体(GBK编码)的 PDF，验证 cMaps 本地化后中文不乱码。
用 pdf.js 官方测试用的 CID 字体描述(不嵌入字体文件，用系统字体替代渲染)。"""
import zlib

# 简单方法：构造一个用 Type0/GBK 编码的中文文本 PDF
# 文本 "合同签署测试" 的 GBK 编码: 合=BA CF 同=CD AC 签=C7 A9 署=CA F0 测=B2 E2 试=CA D4
gbk_text = bytes([0xBA, 0xCF, 0xCD, 0xAC, 0xC7, 0xA9, 0xCA, 0xF0, 0xB2, 0xE2, 0xCA, 0xD4])

def esc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if o < 32 or o > 126 or ch in '()\\':
            out.append('\\%03o' % o)
        else:
            out.append(ch)
    return ''.join(out)

objs = []
def add(data):
    objs.append(data)
    return len(objs)

# 内容流: 使用 Type0 字体渲染 GBK 文本
stream_data = b'''q
0.95 0.97 0.98 rg
0 0 595.28 841.89 re f
BT
/F1 28 Tf
0 0.2 0.55 rg
60 720 Td
<BA CF CD AC C7 A9 CA F0 B2 E2 CA D4> Tj
ET
BT
/F1 14 Tf
0.3 0.3 0.3 rg
60 680 Td
(This page uses a GBK CID font. cMaps must resolve it.) Tj
ET
Q
'''
c1 = add(b'<< /Length %d >>\nstream\n%s\nendstream' % (len(stream_data), stream_data))

# Type0 字体: GBK-EUC-H 编码 (Identity-H + CIDFont 简化为 GBK-EUC-H CMap)
f1 = add(b'<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /GBK-EUC-H /DescendantFonts [%d 0 R] >>' % 0)
# CIDFontType2 (用系统 SimSun)
f2 = add(b'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SimSun /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor %d 0 R >>' % 0)
f3 = add(b'<< /Type /FontDescriptor /FontName /SimSun /Flags 4 /FontBBox [0 -210 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -210 /CapHeight 700 /StemV 80 >>')
# 修正引用
objs[f1-1] = b'<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /GBK-EUC-H /DescendantFonts [%d 0 R] >>' % f2
objs[f2-1] = b'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SimSun /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor %d 0 R >>' % f3

res = add(b'<< /Font << /F1 %d 0 R >> >>' % f1)
p1 = add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.28 841.89] /Resources %d 0 R /Contents %d 0 R >>' % (0, res, c1))
kids = add(b'<< /Type /Pages /Kids [%d 0 R] /Count 1 >>' % p1)
catalog = add(b'<< /Type /Catalog /Pages %d 0 R >>' % kids)
objs[p1-1] = b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.28 841.89] /Resources %d 0 R /Contents %d 0 R >>' % (kids, res, c1)

out = [b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n']
offsets = [0]
for i, o in enumerate(objs):
    offsets.append(len(b''.join(out)))
    out.append(b'%d 0 obj\n' % (i+1))
    out.append(o if isinstance(o, bytes) else str(o).encode())
    out.append(b'\nendobj\n')
xref = len(b''.join(out))
out.append(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs)+1))
for off in offsets[1:]:
    out.append(b'%010d 00000 n \n' % off)
out.append(b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs)+1, catalog, xref))

data = b''.join(out)
open('/var/minis/workspace/pdf-stamp-picker/demo/chinese-cid.pdf', 'wb').write(data)
print('chinese-cid.pdf 生成:', len(data), 'bytes (GBK CID 中文)')
