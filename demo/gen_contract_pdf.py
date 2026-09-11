#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 demo/test.pdf —— 三方签署的《技术服务及履约保证三方协议》虚拟电子合同。

为什么要这么生成（三条都是踩过的结论，别随手改）：
 1) 中文字体**必须子集化嵌入**（Type0 / Identity-H + ToUnicode）。
    非嵌入 CID 方案（GBK-EUC-H 等，见 gen_chinese_pdf.py）在 pdf.js 下
    **只能抽出文字、画不出字形**：实测 chinese-cid.pdf 的中文标题带
    y=700..750 区域深色像素 = 0，而英文带 = 1397。且它还要运行时 cMaps。
 2) 本合同是 demo 与 17 个浏览器回归套件**共用夹具**，必须自包含：
    无 cMaps、无系统字体依赖，离线可用。
 3) 页数被硬编码契约锁死：index.html 断言 getTotalPages() === 3，
    跨套件对账也要求"页数全部为 3"。本脚本末尾有硬校验，页数变了直接报错，
    不会悄悄产出让回归挂掉的夹具。
 4) 产物必须**逐字节可复现**：子集字体保存前固定 head.modified 并关掉
    recalcTimestamp —— fontTools 默认会在 save() 里写入"当前时间"，
    实测同一输入两次生成的 PDF 有 91140 字节不同（差异全落在内嵌字体这一个
    对象里），于是 hash-nonsecure-test.html 的 EXPECT 永远对不上。
    改正文内容后需同步哈希（脚本结尾会打印新值，同步点见 README「测试」一节）。

依赖（只在生成时需要，产物自包含）：
    apk add py3-fonttools font-wqy-zenhei
用法：
    python3 demo/gen_contract_pdf.py [输出路径，默认 demo/test.pdf]
"""

import hashlib
import io
import os
import re
import sys
import zlib

from fontTools.ttLib import TTCollection
from fontTools.subset import Options, Subsetter

FONT_PATH = '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc'
FONT_INDEX = 0                      # TTC 里第 0 个 = WenQuanYi Zen Hei
EXPECTED_PAGES = 3                  # ← 契约，见文件头第 3 条
FIXED_TS = 3871929600               # 2026-09-11 00:00 UTC（Mac epoch），写进子集字体 head.modified

# ---------------------------------------------------------------- 版面常量
PAGE_W, PAGE_H = 595.28, 841.89     # A4
ML, MR = 54.0, 54.0
MT, MB = 56.0, 60.0
BOT = MB          # 正文下边界（页脚在其下方）；layout() 与 report() 共用同一个值
CW = PAGE_W - ML - MR               # 正文栏宽 487.28

BODY_SIZE, BODY_LEAD = 8.6, 14.0    # 正文
HEAD_SIZE = 9.6                     # 条标题
TITLE_SIZE = 17.0
TBL_SIZE = 7.5
FOOT_SIZE = 7.0
HDR_H = 24.0                        # 第 2 页起的页眉高度
FOOT_Y = 38.0                       # 页脚文字基线
SIGN_H = 206.0                      # 签署区整块高度（不可跨页拆分）

C_INK = (0.11, 0.11, 0.12)          # 正文墨色
C_HEAD = (0.10, 0.15, 0.30)         # 条标题（深蓝）
C_TITLE = (0.08, 0.13, 0.28)
C_MUTE = (0.45, 0.47, 0.50)         # 页脚 / 注记
C_RULE = (0.72, 0.74, 0.78)
C_FILL = (0.945, 0.953, 0.965)      # 表头底色

DOC_TITLE = '技术服务及履约保证三方协议'
DOC_NO = 'YQ-SL-2026-0911'
DISCLAIM = '本文件为电子签章演示样例，所载主体、编号与金额均为虚构'

PARTIES = [
    dict(role='甲方', sub='采购方', uid='u1', color='#4285f4',
         name='杭州云启智能科技有限公司', code='91330110MA2QY70X8A',
         legal='陈立群', addr='浙江省杭州市余杭区文一西路 998 号 3 幢 12 层',
         tel='0571-8888 0001'),
    dict(role='乙方', sub='服务方', uid='u2', color='#ea4335',
         name='深圳数联信息技术有限公司', code='91440300MA5FL21K7B',
         legal='林嘉禾', addr='广东省深圳市南山区科技南十二路 18 号 6 层',
         tel='0755-8666 0002'),
    dict(role='丙方', sub='保证方', uid='u3', color='#34a853',
         name='北京中泰融资担保有限公司', code='91110108MA01T93M2C',
         legal='周慕云', addr='北京市海淀区中关村南大街甲 18 号 9 层',
         tel='010-6266 0003'),
]

# ---------------------------------------------------------------- 合同正文
# 结构说明：('h1' 标题) ('rule' 分隔线) ('meta' 编号/日期) ('parties' 三方主体表)
#          ('h' 条标题) ('p' 条款正文) ('gap' 空行) ('note' 灰字居中) ('sign' 签署区)
ITEMS = [
    ('h1', DOC_TITLE),
    ('rule',),
    ('meta',),
    ('parties',),
    ('gap', 7),
    ('p', '鉴于甲方拟建设智能仓储管理系统，乙方具备相应的软件开发与技术实施能力，'
          '丙方愿意就乙方在本协议项下的违约责任向甲方提供连带责任保证；'
          '三方本着平等自愿、诚实信用的原则，经充分协商，就有关事宜达成如下协议：'),
    ('gap', 5),

    ('h', '第一条  定义与协议构成'),
    ('p', '1.1 本协议所称"系统"，指乙方按本协议约定为甲方开发、部署并提供运维支持的智能仓储管理系统，'
          '包含软件程序、接口、技术文档及配套服务。'),
    ('p', '1.2 本协议所称"交付物"，指需求说明书、概要设计、详细设计、源代码、部署手册、'
          '测试报告及验收报告等，具体范围以附件一《交付物清单》为准。'),
    ('p', '1.3 本协议正文、全部附件及三方书面确认的变更文件共同构成完整协议；'
          '前述文件约定不一致时，以签署时间在后者为准。'),

    ('h', '第二条  服务内容与交付标准'),
    ('p', '2.1 乙方负责系统的需求分析、设计、开发、测试、部署、培训，'
          '以及质保期内的运行维护与技术支持。'),
    ('p', '2.2 系统应满足附件二《技术规格书》约定的功能与性能指标，'
          '其中订单处理峰值不低于 3000 单/小时，接口平均响应时间不高于 200 毫秒。'),
    ('p', '2.3 乙方应于本协议生效之日起 120 个自然日内完成开发并提交验收申请；'
          '因甲方原因造成的延误，交付期限相应顺延，三方另行书面确认。'),

    ('h', '第三条  合同价款与支付方式'),
    ('p', '3.1 本协议价款总额为人民币壹佰捌拾万元整（￥1,800,000.00），为含税总价，'
          '已包含开发、部署、培训及质保期内的一切费用。'),
    ('p', '3.2 价款按进度分期支付：'
          '（一）本协议生效之日起 10 个工作日内支付 30%，计人民币伍拾肆万元整；'
          '（二）系统初验合格之日起 10 个工作日内支付 40%，计人民币柒拾贰万元整；'
          '（三）终验合格并交付全部交付物之日起 10 个工作日内支付 25%，计人民币肆拾伍万元整；'
          '（四）剩余 5%（计人民币玖万元整）作为质保金，于质保期届满且无质量异议后 10 个工作日内支付。'),
    ('p', '3.3 甲方每次付款前，乙方应开具等额增值税专用发票；'
          '丙方对甲方的付款义务不承担代为付款责任。'),

    ('h', '第四条  项目进度与验收'),
    ('p', '4.1 三方应于本协议生效后 5 个工作日内成立项目组，各指定一名项目负责人，'
          '负责日常沟通、进度确认与事项签认。'),
    ('p', '4.2 乙方完成阶段工作后应书面通知甲方验收；甲方应在收到通知之日起 10 个工作日内'
          '组织验收，逾期未组织且未提出书面异议的，视为验收通过。'),
    ('p', '4.3 验收不合格的，乙方应在收到书面异议之日起 15 个工作日内无偿整改并重新提交验收，'
          '整改次数不超过两次；两次整改后仍不合格的，甲方有权解除本协议。'),

    ('h', '第五条  三方权利义务'),
    ('p', '5.1 甲方应按约定支付价款，提供必要的场地、数据与人员配合，'
          '并对所提供资料的真实性、合法性负责。'),
    ('p', '5.2 乙方应按约定进度与标准交付，保证交付物不侵犯任何第三方的合法权益，'
          '并指派不少于 5 名专职技术人员参与本项目。'),
    ('p', '5.3 丙方就乙方在第九条项下的违约责任向甲方提供连带责任保证；'
          '甲方主张保证责任时，应提前 5 个工作日书面通知丙方，并提供相应证明材料。'),
]

ITEMS += [
    ('h', '第六条  知识产权与成果归属'),
    ('p', '6.1 甲方按本协议约定支付全部价款后，取得系统定制部分的使用权'
          '及相关技术文档的所有权。'),
    ('p', '6.2 乙方在本协议签署前已拥有的通用组件、基础框架及开发工具，'
          '其知识产权仍归乙方所有；乙方在此授予甲方在本项目范围内不可转让、不可再许可的使用权。'),
    ('p', '6.3 未经对方书面同意，任何一方不得将对方的名称、商标用于本项目之外的宣传或商业用途。'),

    ('h', '第七条  保密条款'),
    ('p', '7.1 三方对因履行本协议而获知的对方商业秘密、技术资料、客户信息及未公开的经营数据'
          '负有保密义务，保密期限自本协议生效之日起至该信息进入公开领域之日止。'),
    ('p', '7.2 保密信息仅可用于履行本协议之目的，接收方应将其知悉范围限制在'
          '确有必要知悉的人员内，并要求相关人员承担同等保密义务。'),
    ('p', '7.3 下列信息不属于保密信息：接收方在披露前已合法知悉的；'
          '非因接收方原因已进入公开领域的；依法律法规或监管机关要求必须披露的。'),

    ('h', '第八条  数据安全与个人信息保护'),
    ('p', '8.1 乙方处理甲方业务数据应遵守法律法规及国家标准，采取加密传输、访问控制、'
          '日志审计等必要措施，不得超出本协议约定的目的与范围使用。'),
    ('p', '8.2 涉及个人信息处理的，三方应另行签署《数据处理协议》作为附件三，'
          '明确处理目的、方式、期限及各方责任。'),
    ('p', '8.3 发生数据安全事件的，乙方应在 24 小时内通知甲方，'
          '并配合采取补救措施、留存相关记录。'),
    ('p', '8.4 乙方应在系统交付前完成数据安全自查，向甲方提交数据流向说明与安全措施清单，'
          '并配合甲方开展必要的安全核查。'),

    ('h', '第九条  违约责任'),
    ('p', '9.1 任何一方未按本协议约定履行义务的，应承担继续履行、采取补救措施'
          '或赔偿损失等违约责任。'),
    ('p', '9.2 乙方逾期交付的，每逾期一日按合同总额的 0.3‰ 向甲方支付违约金；'
          '逾期超过 30 日的，甲方有权解除本协议并要求乙方赔偿损失。'),
    ('p', '9.3 甲方逾期付款的，每逾期一日按应付未付金额的 0.3‰ 向乙方支付违约金。'),
    ('p', '9.4 丙方在保证范围内承担连带责任后，有权就其实际承担的全部金额向乙方追偿。'),
    ('p', '9.5 因一方违约给对方造成损失的，违约方应赔偿对方因此遭受的直接经济损失，'
          '以及对方为防止损失扩大而支出的合理费用。'),

    ('h', '第十条  不可抗力与争议解决'),
    ('p', '10.1 因不可抗力致使一方不能履行本协议的，该方应在事件发生后 5 个工作日内'
          '书面通知其他方并提供证明，根据影响程度部分或全部免除责任。'),
    ('p', '10.2 本协议适用中华人民共和国法律（不含香港、澳门特别行政区及台湾地区法律）。'),
    ('p', '10.3 因本协议引起的或与本协议有关的争议，三方应友好协商解决；协商不成的，'
          '任何一方均可向甲方所在地有管辖权的人民法院提起诉讼。'),

    ('h', '第十一条  质保期与售后服务'),
    ('p', '11.1 质保期为系统终验合格之日起 24 个月。质保期内，乙方应免费提供缺陷修复、'
          '补丁升级、性能调优及必要的现场支持，不得另行收取费用。'),
    ('p', '11.2 乙方应设立服务热线与在线支持渠道，接到故障报告后 30 分钟内响应；'
          '一般故障应在 8 小时内修复，影响业务连续运行的重大故障应于 4 小时内到场处理，'
          '并持续跟进至系统恢复正常。'),
    ('p', '11.3 质保期届满后，甲方如需继续获得运维服务，双方可另行签订年度运维服务协议，'
          '服务费用由双方协商确定，且不高于本协议价款的 8%。'),

    ('h', '第十二条  培训与技术支持'),
    ('p', '12.1 乙方应在系统上线前为甲方业务人员与运维人员提供不少于 40 人次的培训，'
          '内容涵盖功能操作、日常维护、常见故障处置以及数据备份与恢复。'),
    ('p', '12.2 乙方应随系统交付完整的用户手册、运维手册与接口说明文档，'
          '并在质保期内免费提供更新版本。'),
    ('p', '12.3 培训与文档的完成情况作为终验的组成部分，未按约定完成的，不予通过终验。'),

    ('h', '第十三条  权利与义务的转让'),
    ('p', '13.1 未经甲方与丙方事先书面同意，乙方不得将本协议项下的权利或义务转让给第三人，'
          '亦不得将系统开发的主体工作分包给他人。'),
    ('p', '13.2 乙方经书面同意将非主体、非关键性工作分包的，'
          '仍应就分包部分向甲方承担全部责任，并对分包方的行为负责。'),
    ('p', '13.3 甲方未经乙方书面同意，不得将其在本协议项下的付款义务转让给第三人；'
          '但甲方因合并、分立等法定原因发生主体变更的除外。'),

    ('h', '第十四条  通知与送达'),
    ('p', '14.1 三方应以书面形式发出通知，采取邮寄、电子邮件或当面递交方式，'
          '送达本协议首部载明的地址与联系方式。'),
    ('p', '14.2 通知以邮寄方式发出的，自交邮之日起第 5 个工作日视为送达；'
          '以电子邮件方式发出的，自发送成功之日起视为送达。'),
    ('p', '14.3 任何一方的地址或联系方式发生变更的，应在变更之日起 5 个工作日内'
          '书面通知其他方；未及时通知致使通知无法送达的，由未通知方承担相应后果。'),

    ('h', '第十五条  协议的生效、变更与解除'),
    ('p', '15.1 本协议经三方法定代表人或授权代表签字并加盖公章后生效，'
          '任何一方不得单方变更或解除。'),
    ('p', '15.2 三方协商一致，可以书面形式变更或解除本协议；'
          '变更或解除不影响已经发生的权利义务，亦不免除违约方应承担的违约责任。'),
    ('p', '15.3 出现下列情形之一的，守约方有权书面通知解除本协议：'
          '（一）一方严重违约，且在收到书面催告后 15 个工作日内仍未纠正；'
          '（二）一方进入破产、清算程序或者丧失履约能力；'
          '（三）法律规定的其他可以解除协议的情形。'),

    ('h', '第十六条  廉洁与合规'),
    ('p', '16.1 三方在协议签订与履行过程中，不得以任何形式向对方工作人员提供或索取不正当利益，'
          '不得实施商业贿赂、利益输送等违法违规行为。'),
    ('p', '16.2 任何一方发现对方存在上述行为的，有权书面通知解除本协议，'
          '并要求对方赔偿由此造成的损失。'),

    ('h', '第十七条  其他约定'),
    ('p', '17.1 本协议未尽事宜，三方可另行签订补充协议，补充协议与本协议具有同等法律效力。'),
    ('p', '17.2 本协议的任何修改、变更均须经三方书面确认，口头变更无效。'),
    ('p', '17.3 本协议的条款标题仅为便于阅读而设，不影响条款的含义与解释。'),
    ('p', '17.4 本协议附件包括附件一《交付物清单》、附件二《技术规格书》与附件三《数据处理协议》，'
          '均为本协议不可分割的组成部分，与正文具有同等法律效力。'),

    ('gap', 6),
    ('note', '（本协议正文结束，以下为签署页）'),
    ('sign',),
]

# ---------------------------------------------------------------- 字体度量
class MissingGlyph(Exception):
    pass


class Font:
    """只做度量：子集化会保留 advance，所以用原始字体先排版、后取 GID 是安全的。"""

    def __init__(self, path, index=0):
        self.tt = TTCollection(path).fonts[index]
        self.upem = self.tt['head'].unitsPerEm
        self.cmap = self.tt.getBestCmap()
        self.hmtx = self.tt['hmtx']

    def adv(self, ch):
        gn = self.cmap.get(ord(ch))
        if gn is None:
            raise MissingGlyph(ch)
        return self.hmtx[gn][0]

    def width(self, s, size):
        if not s:
            return 0.0
        return sum(self.adv(c) for c in s) * size / float(self.upem)


NO_START = '，。、；：？！）》」』】〉·%‰”’…'      # 不能出现在行首（中文禁则）
NO_END = '（《「『【〈“‘'                          # 不能出现在行末
TOKEN_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._%/\-]*')


def split_tokens(s):
    """ASCII 连续段（数字/英文/编号）作为整体，避免被拆断；其余按单字断。"""
    out, i = [], 0
    while i < len(s):
        m = TOKEN_RE.match(s, i)
        if m:
            out.append(m.group(0))
            i = m.end()
        else:
            out.append(s[i])
            i += 1
    return out


def wrap(font, s, size, maxw):
    lines, cur = [], ''
    for t in split_tokens(s):
        if cur and font.width(cur + t, size) > maxw:
            lines.append(cur)
            cur = t
        else:
            cur += t
    if cur:
        lines.append(cur)
    for i in range(1, len(lines)):               # 行首禁则
        while lines[i] and lines[i][0] in NO_START and len(lines[i - 1]) > 1:
            lines[i - 1] += lines[i][0]
            lines[i] = lines[i][1:]
    for i in range(len(lines) - 1):              # 行末禁则
        while lines[i] and lines[i][-1] in NO_END and len(lines[i]) > 1:
            ch = lines[i][-1]
            lines[i] = lines[i][:-1]
            lines[i + 1] = ch + lines[i + 1]
    return lines


# ---------------------------------------------------------------- PDF 组装
def utf16_hex(s):
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'


class PDF:
    def __init__(self):
        self.objs = []

    def add(self, data=b''):
        self.objs.append(b'')
        self.set(len(self.objs), data)
        return len(self.objs)

    def set(self, oid, data):
        if isinstance(data, str):
            data = data.encode('latin-1')
        self.objs[oid - 1] = data

    def build(self, root, info):
        out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
        offsets = [0] * (len(self.objs) + 1)
        for i, body in enumerate(self.objs, start=1):
            offsets[i] = len(out)
            out += b'%d 0 obj\n' % i
            out += body
            out += b'\nendobj\n'
        xref = len(out)
        n = len(self.objs) + 1
        out += b'xref\n0 %d\n' % n
        out += b'0000000000 65535 f \n'
        for i in range(1, n):
            out += b'%010d 00000 n \n' % offsets[i]
        out += (b'trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n'
                % (n, root, info, xref))
        return bytes(out)


def stream_dict(extra, data):
    comp = zlib.compress(data)
    return ('<< %s /Length %d /Filter /FlateDecode >>\nstream\n' % (extra, len(comp))).encode('latin-1') \
        + comp + b'\nendstream'

# ---------------------------------------------------------------- 版面绘制
class Doc:
    def __init__(self, font):
        self.font = font
        self.pages = [[]]
        self.cur = 0
        self.used = set()

    def page(self):
        return self.pages[self.cur]

    def newpage(self):
        self.pages.append([])
        self.cur = len(self.pages) - 1

    def text(self, x, y, s, size, color=C_INK, bold=False, align='left', width=None):
        w = self.font.width(s, size)
        if align == 'center':
            x = x + (width - w) / 2.0
        elif align == 'right':
            x = x + (width - w)
        self.used.update(s)
        self.page().append(('text', x, y, size, s, color, bold))
        return w

    def line(self, x1, y1, x2, y2, color=C_RULE, lw=0.6, dash=None):
        self.page().append(('line', x1, y1, x2, y2, color, lw, dash))

    def rect(self, x, y, w, h, stroke=None, fill=None, lw=0.6, dash=None):
        self.page().append(('rect', x, y, w, h, stroke, fill, lw, dash))

    def textv(self, x, y, s, size, color=C_MUTE):
        """竖排文字（骑缝章标记用）。"""
        self.used.update(s)
        self.page().append(('textv', x, y, size, s, color))


def draw_header_footer(doc, idx, n):
    doc.cur = idx
    if n > 1:
        doc.text(ML, PAGE_H - MT + 8, DOC_TITLE, 7.8, C_MUTE, align='center', width=CW)
        doc.line(ML, PAGE_H - MT, PAGE_W - MR, PAGE_H - MT, C_RULE, 0.5)
    doc.line(ML, FOOT_Y + 10, PAGE_W - MR, FOOT_Y + 10, C_RULE, 0.5)
    doc.text(ML, FOOT_Y, '合同编号：' + DOC_NO, FOOT_SIZE, C_MUTE)
    doc.text(ML, FOOT_Y, '第 %d 页 / 共 %d 页' % (n, EXPECTED_PAGES), FOOT_SIZE, C_MUTE,
             align='center', width=CW)
    doc.text(ML, FOOT_Y, '演示样例 · 虚构文件', FOOT_SIZE, C_MUTE, align='right', width=CW)


def draw_seam(doc):
    """页右缘的骑缝章标记（第 1、2 页）：虚线 + 竖排小字。"""
    doc.line(PAGE_W - 40, 330, PAGE_W - 40, 424, (0.78, 0.80, 0.84), 0.5, dash=[2, 3])
    doc.textv(PAGE_W - 31, 338, '骑缝章（跨页盖章处）', 6.6)


def draw_parties(doc, y):
    for p in PARTIES:
        doc.text(ML, y, '%s（%s）：' % (p['role'], p['sub']), 8.6, C_INK, bold=True)
        x = ML + doc.font.width('%s（%s）：' % (p['role'], p['sub']), 8.6)
        doc.text(x, y, p['name'], 8.6, C_HEAD, bold=True)
        y -= 11.5
        doc.text(ML + 9, y, '统一社会信用代码：' + p['code'], TBL_SIZE, C_INK)
        y -= 11.0
        line = '法定代表人：%s        住所：%s        联系电话：%s' % (p['legal'], p['addr'], p['tel'])
        doc.text(ML + 9, y, line, TBL_SIZE, C_INK)
        y -= 15.0
    return y


def draw_sign(doc, y):
    doc.line(ML, y, PAGE_W - MR, y, C_RULE, 0.5)
    y -= 15
    doc.text(ML, y, '签 署 页', 10.4, C_HEAD, bold=True, align='center', width=CW)
    y -= 20
    gap = 13.0
    colw = (CW - 2 * gap) / 3.0
    boxh = 96.0
    for i, p in enumerate(PARTIES):
        x = ML + i * (colw + gap)
        yy = y
        doc.text(x, yy, '%s（%s）（盖章）' % (p['role'], p['sub']), 8.6, C_HEAD, bold=True)
        yy -= 12
        doc.text(x, yy, p['name'], 8.0, C_INK)
        yy -= 5
        doc.rect(x, yy - boxh, colw, boxh, stroke=(0.70, 0.73, 0.78),
                 fill=(0.975, 0.978, 0.986), lw=0.7, dash=[3, 3])
        doc.text(x, yy - boxh / 2 + 2.5, '公 章 / 合 同 专 用 章', 6.6, (0.66, 0.69, 0.74),
                 align='center', width=colw)
        yy -= boxh + 11
        doc.text(x, yy, '法定代表人 / 授权代表（签字）：', 7.3, C_INK)
        yy -= 12
        doc.line(x + 4, yy + 3.5, x + colw - 4, yy + 3.5, (0.55, 0.58, 0.62), 0.5, dash=[2, 2])
        yy -= 11
        doc.text(x, yy, '日  期：       年     月     日', 7.3, C_INK)


def top_of_page(n):
    """第 n 页的内容顶（pt，从页面底部往上算）。第 2 页起顶部有页眉，正文起点下移 HDR_H。"""
    return PAGE_H - MT - (HDR_H if n > 1 else 0.0)


def layout(doc):
    trace = bool(os.environ.get('PDFGEN_TRACE'))
    top = top_of_page
    bot = BOT
    n, y = 1, top(1)
    for item in ITEMS:
        kind = item[0]
        if kind == 'h1':
            y -= 4
            doc.text(ML, y, item[1], TITLE_SIZE, C_TITLE, bold=True, align='center', width=CW)
            y -= 10
            doc.line(ML, y, PAGE_W - MR, y, (0.16, 0.22, 0.40), 1.3)
            y -= 12
            doc.text(ML, y, DISCLAIM, 7.0, C_MUTE, align='right', width=CW)
            y -= 14
        elif kind == 'rule':
            y -= 3          # h1 已经画了标题下的强调线，这里只留间距
        elif kind == 'meta':
            rows = [('合同编号：' + DOC_NO, '签订地点：浙江省杭州市余杭区'),
                    ('签订日期：二〇二六年九月十一日', '协议份数：一式三份，三方各持一份')]
            for a, b in rows:
                doc.text(ML, y, a, 8.0, C_INK)
                doc.text(ML + CW / 2, y, b, 8.0, C_INK)
                y -= 12.0
            y -= 5
        elif kind == 'parties':
            y = draw_parties(doc, y)
        elif kind == 'h':
            need = HEAD_SIZE * 1.5 + 9 + 2 * BODY_LEAD
            if y - need < bot:
                n += 1
                doc.newpage()
                y = top(n)
            y -= 9
            doc.text(ML, y, item[1], HEAD_SIZE, C_HEAD, bold=True)
            y -= BODY_LEAD
        elif kind == 'p':
            lines = wrap(doc.font, item[1], BODY_SIZE, CW)
            for ln in lines:
                if y - BODY_LEAD < bot:
                    n += 1
                    doc.newpage()
                    y = top(n)
                doc.text(ML, y, ln, BODY_SIZE, C_INK)
                y -= BODY_LEAD
            y -= 1.5
        elif kind == 'gap':
            y -= item[1]
        elif kind == 'note':
            if y - 16 < bot:
                n += 1
                doc.newpage()
                y = top(n)
            doc.text(ML, y, item[1], 7.6, C_MUTE, align='center', width=CW)
            y -= 16
        elif kind == 'sign':
            if y - SIGN_H < bot:
                n += 1
                doc.newpage()
                y = top(n)
            draw_sign(doc, y)
            y -= SIGN_H
        else:
            raise SystemExit('未知 item 类型：%r' % (kind,))
        if trace:
            print('  p%d  y=%7.2f  已用=%6.2f  %s' % (n, y, top(n) - y, kind))
    for i in range(len(doc.pages)):
        draw_header_footer(doc, i, i + 1)
        if i < len(doc.pages) - 1:
            draw_seam(doc)
    doc.cur = 0
    return len(doc.pages)

# ---------------------------------------------------------------- 子集化与组装
def hexs(s, gid):
    return '<' + ''.join('%04X' % gid[c] for c in s) + '>'


def dashcmd(dash):
    if not dash:
        return '[] 0 d'
    return '[%s] 0 d' % ' '.join('%.1f' % v for v in dash)


def render(doc, i, gid):
    out = []
    for op in doc.pages[i]:
        k = op[0]
        if k == 'text':
            _, x, y, size, s, color, bold = op
            out.append('BT /F1 %.2f Tf %.3f %.3f %.3f rg %.2f %.2f Td'
                       % (size, color[0], color[1], color[2], x, y))
            if bold:
                out.append('2 Tr %.2f w' % (size * 0.034))   # 伪粗体：填充+描边
            out.append(hexs(s, gid) + ' Tj')
            if bold:
                out.append('0 Tr')
            out.append('ET')
        elif k == 'line':
            _, x1, y1, x2, y2, c, lw, dash = op
            out.append('q %.3f %.3f %.3f RG %.2f w %s %.2f %.2f m %.2f %.2f l S Q'
                       % (c[0], c[1], c[2], lw, dashcmd(dash), x1, y1, x2, y2))
        elif k == 'rect':
            _, x, y, w, h, stroke, fill, lw, dash = op
            seg = ['q']
            if fill:
                seg.append('%.3f %.3f %.3f rg' % fill)
            if stroke:
                seg.append('%.3f %.3f %.3f RG %.2f w %s'
                           % (stroke[0], stroke[1], stroke[2], lw, dashcmd(dash)))
            seg.append('%.2f %.2f %.2f %.2f re' % (x, y, w, h))
            seg.append('B' if (fill and stroke) else ('f' if fill else 'S'))
            seg.append('Q')
            out.append(' '.join(seg))
        elif k == 'textv':
            _, x, y, size, s, c = op
            out.append('BT /F1 %.2f Tf %.3f %.3f %.3f rg 0 1 -1 0 %.2f %.2f Tm %s Tj ET'
                       % (size, c[0], c[1], c[2], x, y, hexs(s, gid)))
    return '\n'.join(out) + '\n'


def subset(chars):
    tt = TTCollection(FONT_PATH).fonts[FONT_INDEX]
    opt = Options()
    opt.layout_features = []
    opt.notdef_outline = True
    opt.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'vhea', 'vmtx', 'cvt ', 'gasp', 'BDF', 'FFTM']
    s = Subsetter(options=opt)
    s.populate(unicodes=[ord(c) for c in chars])
    s.subset(tt)
    cmap = tt.getBestCmap()
    upem = tt['head'].unitsPerEm
    gid, wid = {}, {}
    for c in chars:
        gn = cmap.get(ord(c))
        if gn is None:
            raise SystemExit('子集化后丢了字形：%r' % c)
        gid[c] = tt.getGlyphID(gn)
        wid[c] = tt['hmtx'][gn][0] * 1000.0 / upem
    buf = io.BytesIO()
    # ★ 必须关掉 recalcTimestamp：fontTools 默认在 save() 里把 head.modified 写成"当前时间"，
    #   于是同一份输入每次产出的字节都不同 → test.pdf 的 sha256 不可复现，
    #   hash-nonsecure-test.html 的 EXPECT / README 里那个哈希就永远对不上（实测差异 91140 字节，
    #   全部落在内嵌字体子集这一个对象里）。固定为文档日期，生成结果逐字节可复现。
    tt['head'].modified = FIXED_TS
    tt.recalcTimestamp = False      # ← 实例属性（TTFont.save() 没有这个参数），见上
    tt.save(buf)
    return dict(data=buf.getvalue(), gid=gid, wid=wid, tt=tt)


def w_array(wid, gid):
    """按 CID 升序等宽游程合并：/W [ c [w w w] c [w] ... ]"""
    items = sorted((g, wid[c]) for c, g in gid.items())
    parts, i = [], 0
    while i < len(items):
        g0, w0 = items[i]
        run = [w0]
        j = i + 1
        while j < len(items) and items[j][0] == g0 + len(run) and abs(items[j][1] - w0) < 0.5:
            run.append(items[j][1])
            j += 1
        parts.append('%d [%s]' % (g0, ' '.join('%d' % round(w) for w in run)))
        i = j
    return ' '.join(parts)


def tounicode(gid):
    items = sorted((g, c) for c, g in gid.items())
    body = ''
    for i in range(0, len(items), 100):
        chunk = items[i:i + 100]
        body += '%d beginbfchar\n' % len(chunk)
        for g, c in chunk:
            body += '<%04X> <%s>\n' % (g, c.encode('utf-16-be').hex().upper())
        body += 'endbfchar\n'
    return (('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
             '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
             '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n'
             '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n')
            + body + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n').encode('latin-1')


def build_pdf(doc, sub):
    pdf = PDF()
    catalog, pages = pdf.add(), pdf.add()
    page_ids = [pdf.add() for _ in doc.pages]
    cont_ids = [pdf.add() for _ in doc.pages]
    font0, cidfont, desc, ff, tou = pdf.add(), pdf.add(), pdf.add(), pdf.add(), pdf.add()

    pdf.set(catalog, '<< /Type /Catalog /Pages %d 0 R >>' % pages)
    pdf.set(pages, '<< /Type /Pages /Count %d /Kids [%s] >>'
             % (len(page_ids), ' '.join('%d 0 R' % p for p in page_ids)))
    for i in range(len(doc.pages)):
        data = render(doc, i, sub['gid']).encode('latin-1')
        pdf.set(cont_ids[i], stream_dict('', data))
        pdf.set(page_ids[i],
                '<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] /Resources '
                '<< /Font << /F1 %d 0 R >> /ProcSet [/PDF /Text] >> /Contents %d 0 R >>'
                % (pages, PAGE_W, PAGE_H, font0, cont_ids[i]))
    pdf.set(font0, '<< /Type /Font /Subtype /Type0 /BaseFont /WQYZenHei /Encoding /Identity-H '
                   '/DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>' % (cidfont, tou))
    pdf.set(cidfont, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /WQYZenHei '
                     '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
                     '/FontDescriptor %d 0 R /DW 1000 /W [%s] /CIDToGIDMap /Identity >>'
             % (desc, w_array(sub['wid'], sub['gid'])))
    head = sub['tt']['head']
    sc = 1000.0 / head.unitsPerEm
    pdf.set(desc, '<< /Type /FontDescriptor /FontName /WQYZenHei /Flags 4 '
                  '/FontBBox [%.0f %.0f %.0f %.0f] /ItalicAngle 0 /Ascent %.0f /Descent %.0f '
                  '/CapHeight %.0f /StemV 80 /FontFile2 %d 0 R >>'
             % (head.xMin * sc, head.yMin * sc, head.xMax * sc, head.yMax * sc,
                head.yMax * sc, head.yMin * sc, head.yMax * sc * 0.72, ff))
    pdf.set(ff, stream_dict('/Length1 %d' % len(sub['data']), sub['data']))
    pdf.set(tou, stream_dict('', tounicode(sub['gid'])))
    info = pdf.add('<< /Title %s /Producer (PdfStampPicker demo fixture) '
                   "/Creator (demo/gen_contract_pdf.py) /CreationDate (D:20260911000000+08'00') >>"
                   % utf16_hex(DOC_TITLE))
    return pdf.build(catalog, info), len(pdf.objs)


def report(doc):
    """分页自检：生成器自己说得清每一项落在哪里，越框必须在这里暴露。

    刻意**不**依赖渲染像素（那是另一步交叉验证）。三类文字分开判定：
      · 正文   BOT < y <= 内容顶           —— 必须落在内容框内
      · 页眉   y > 内容顶（第 2 页起的书名页眉）—— 允许，但不得逼近纸边
      · 页脚   y <= BOT（页码/编号/免责）  —— 允许
    右边距外的竖线是**有意**装饰（骑缝章位置标记，真实骑缝章本就跨页边），单独计数。
    """
    print('分页自检：')
    for i, ops in enumerate(doc.pages):
        top = top_of_page(i + 1)
        body, hdr, ft, deco, xmax = [], 0, 0, 0, 0.0
        for op in ops:
            if op[0] == 'text':
                x, y, size, s = op[1], op[2], op[3], op[4]
                xmax = max(xmax, x + doc.font.width(s, size))
                if y <= BOT:
                    ft += 1
                elif y <= top + 0.6:
                    body.append(y)
                else:
                    hdr += 1
                    if y > PAGE_H - MT + 12:
                        raise SystemExit('p%d 页眉顶到纸边之上：y=%.1f' % (i + 1, y))
            elif op[0] == 'line':
                if max(op[1], op[3]) > PAGE_W - MR + 0.6:
                    deco += 1
                else:
                    xmax = max(xmax, op[1], op[3])
            elif op[0] == 'rect':
                xmax = max(xmax, op[1] + op[3])
        print('  p%d 绘制项=%3d 正文行=%3d 页眉=%d 页脚=%d 装饰=%d  正文顶=%.1f 正文底=%.1f 最右=%.1f'
              % (i + 1, len(ops), len(body), hdr, ft, deco,
                 (max(body) if body else -1), (min(body) if body else -1), xmax))
        if xmax > PAGE_W - MR + 0.6:
            raise SystemExit('p%d 内容越过右边距：x=%.1f > %.1f' % (i + 1, xmax, PAGE_W - MR))
        if body and min(body) < BOT - 0.6:
            raise SystemExit('p%d 正文落到下边界以下：y=%.1f < %.1f' % (i + 1, min(body), BOT))
        if body and max(body) > top + 0.6:
            raise SystemExit('p%d 正文越过上边界：y=%.1f > %.1f' % (i + 1, max(body), top))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'test.pdf')
    font = Font(FONT_PATH, FONT_INDEX)
    doc = Doc(font)
    n = layout(doc)
    if n != EXPECTED_PAGES:
        raise SystemExit(
            '生成结果为 %d 页，与契约 %d 页不符。\n'
            'index.html 断言 getTotalPages() === 3，跨套件对账也要求"页数全部为 3"；\n'
            '请调整内容长度或 BODY_SIZE / BODY_LEAD，不要直接改 EXPECTED_PAGES。'
            % (n, EXPECTED_PAGES))
    report(doc)
    chars = sorted(doc.used)
    missing = [c for c in chars if font.cmap.get(ord(c)) is None]
    if missing:
        raise SystemExit('字体缺字形：%s' % ''.join(missing))
    sub = subset(chars)
    data, nobj = build_pdf(doc, sub)
    with open(out, 'wb') as f:
        f.write(data)
    digest = hashlib.sha256(data).hexdigest()
    print('已生成 %s' % out)
    print('  页数        : %d 页（契约 %d）' % (n, EXPECTED_PAGES))
    print('  文件大小    : %d 字节' % len(data))
    print('  字符/字形   : %d 个（嵌入子集 %d 字节）' % (len(chars), len(sub['data'])))
    print('  PDF 对象数  : %d' % nobj)
    print('  sha256      : %s' % digest)
    print('  前 12 位    : %s  ← hash-nonsecure-test.html 的 EXPECT 与 README 需同步' % digest[:12])


if __name__ == '__main__':
    main()
