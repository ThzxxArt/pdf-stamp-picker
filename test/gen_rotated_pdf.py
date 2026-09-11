#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成带 /Rotate 的测试 PDF（零依赖，手写 PDF 字节）。

用途：端到端验证"库 load() 实际赋值的几何(_pdfW/_pdfH/_rotation/_displayW/_displayH)"
     与 pdf.js viewport 是否一致 —— 交叉验证页用的是手工构造的实例，这里补齐真身链路。

页面内容：在【未旋转坐标系】的四个角附近各画一个彩色方块，
        便于人工/像素探针核对旋转后落点是否符合预期。
"""
import os
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'demo')
W, H = 595.28, 841.89


def content_stream():
    """四角标记：红(左下) 绿(右下) 蓝(左上) 黄(右上)，PDF 坐标 y 自底向上。"""
    parts = []
    boxes = [
        (0.95, 0.20, 0.05, 'R'),   # 左下 红
        (0.85, 0.10, 0.05, 'G'),   # 右下 绿
        (0.15, 0.60, 0.05, 'B'),   # 左上 蓝
        (0.25, 0.70, 0.05, 'Y'),   # 右上 黄
    ]
    s = []
    for bx, by, sz, _ in boxes:
        x = bx * W
        y = by * H
        s.append('%.2f %.2f %.2f %.2f re f' % (x, y, sz * W, sz * H))
    _ = parts
    return '\n'.join(s).encode('latin-1')


def build_pdf(rotate, crop=None):
    """crop=(x0,y0,x1,y1)：写入非零原点的 CropBox（模拟被裁剪过的 PDF）。
    MediaBox 会比 CropBox 大一圈，page.view 返回 CropBox → 库的 _offsetX/_offsetY ≠ 0。
    这一维度历史上从未被验证：库的换算里 offset 是"平移项"，与旋转分支叠加时的正负号
    最容易写反，而真实业务里裁剪 + 旋转的组合并不罕见。"""
    content = content_stream()
    comp = zlib.compress(content)
    objs = []
    objs.append(b'<< /Type /Catalog /Pages 2 0 R >>')
    objs.append(b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    media = b'[0 0 %.2f %.2f]' % (W, H)
    if crop:
        media = b'[0 0 %.2f %.2f]' % (W + 30, H + 40)   # 外扩，保证 CropBox 严格内含
    cropbox = ('/CropBox [%.2f %.2f %.2f %.2f] ' % crop).encode('latin-1') if crop else b''
    objs.append(
        (b'<< /Type /Page /Parent 2 0 R /MediaBox ' + media + b' ' + cropbox +
         ('/Rotate %d ' % rotate).encode() +
         b'/Resources << /ProcSet [/PDF] >> /Contents 4 0 R >>'))
    objs.append(b'<< /Length %d /Filter /FlateDecode >>\nstream\n' % len(comp) + comp + b'\nendstream')

    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += ('%d 0 obj\n' % i).encode() + body + b'\nendobj\n'
    xref_pos = len(out)
    out += ('xref\n0 %d\n' % (len(objs) + 1)).encode()
    out += b'0000000000 65535 f \n'
    for off in offsets:
        out += ('%010d 00000 n \n' % off).encode()
    out += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'
            % (len(objs) + 1, xref_pos)).encode()
    return bytes(out)


def main():
    for rot, name in ((180, 'rot180.pdf'), (90, 'rot90.pdf'), (270, 'rot270.pdf')):
        path = os.path.join(OUT_DIR, name)
        with open(path, 'wb') as f:
            f.write(build_pdf(rot))
        print('%s  %d bytes  /Rotate %d' % (path, os.path.getsize(path), rot))
    # 非零 CropBox 原点 + 旋转：覆盖 offset 与旋转分支叠加的符号正确性
    crop = (10.0, 20.0, 600.0, 860.0)   # page.view = [10,20,600,860] → 尺寸 590×840，offset (10,20)
    for rot in (0, 90, 180, 270):
        path = os.path.join(OUT_DIR, 'crop-rot%d.pdf' % rot)
        with open(path, 'wb') as f:
            f.write(build_pdf(rot, crop=crop))
        print('%s  %d bytes  /Rotate %d CropBox %s' % (path, os.path.getsize(path), rot, list(crop)))


if __name__ == '__main__':
    main()
