#!/usr/bin/env python3
# 模拟内网: 对 pdf.min.js / pdf.worker.min.js 返回错误 MIME(type=text/html)
# → 浏览器 strict MIME checking 拒绝 script 执行(onerror) / new Worker 失败
# → 验证库 fetch+Blob 兜底仍能加载 pdf.js
import http.server, os, urllib.parse

ROOT = '/var/minis/workspace'
PORT = 8897

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        # 只对 pdf.min.js / pdf.worker.min.js 返回错误 MIME(text/html)，模拟内网
        if p.endswith('/pdf.min.js') or p.endswith('/pdf.worker.min.js'):
            fp = os.path.join(ROOT, p.lstrip('/'))
            try:
                with open(fp, 'rb') as f:
                    data = f.read()
            except FileNotFoundError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def log_message(self, fmt, *args):
        print('[8897]', fmt % args)

s = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H)
print('MIME-mock server on', PORT)
s.serve_forever()
