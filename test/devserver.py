#!/usr/bin/env python3
"""开发用静态服务器：**禁用一切缓存**。

为什么要专门写它（血泪教训）：
  改完库、测试页里的 `?v=` 缓存戳却没变 → 浏览器继续用**旧库**跑测试，
  于是"测试失败"其实是测试对象没更新（假失败），或者更糟 —— **假通过**。
  历史上已因此排查过两次（v4.8.27 哈希、v4.9.1 旋转页）。
  给静态服务加 `Cache-Control: no-store` 后，缓存戳只保留"版本可读性"的作用，
  不再承担缓存失效的职责，从此不可能踩到。

用法：python3 test/devserver.py [port] [root]
默认：8899 端口，根目录 = 仓库的上一级（即 /var/minis/workspace，与既有测试 URL 对齐）
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默，避免长跑回归时刷屏


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    # 仓库位于 <root>/pdf-stamp-picker → 服务根取仓库的【上一级】，
    # 这样既有测试 URL（http://127.0.0.1:8899/pdf-stamp-picker/demo/...）不用改。
    here = os.path.abspath(__file__)                       # <root>/pdf-stamp-picker/test/devserver.py
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.dirname(here)))
    handler = partial(NoCacheHandler, directory=root)
    srv = ThreadingHTTPServer(('127.0.0.1', port), handler)
    print('devserver (no-store) serving %s on http://127.0.0.1:%d' % (root, port), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
