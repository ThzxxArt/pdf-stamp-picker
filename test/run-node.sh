#!/bin/sh
# 一键跑全部 Node 单测（浏览器套件 = demo/run-all.html，需要静态服务器：
#   python3 test/devserver.py 8899   → 打开 http://127.0.0.1:8899/pdf-stamp-picker/demo/run-all.html ）
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in docs json coords history addstamp docmeta; do
  if node "test/$t.test.js" > "/tmp/node-$t.log" 2>&1; then
    printf "  OK   %-9s %s\n" "$t" "$(tail -1 "/tmp/node-$t.log" | sed 's/^=== //')"
  else
    fail=1
    printf "  FAIL %-9s （详见 /tmp/node-%s.log）\n" "$t" "$t"
    tail -6 "/tmp/node-$t.log"
  fi
done
if [ "$fail" = 0 ]; then echo ">>> 全部 Node 单测通过"; else echo ">>> 存在失败用例"; fi
exit $fail
