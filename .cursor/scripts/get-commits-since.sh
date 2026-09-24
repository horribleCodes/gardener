#!/bin/bash

git fetch origin > /dev/null 2>&1
git checkout origin/main > /dev/null 2>&1

SHA=$1

git -c color.ui=never log --no-merges --reverse --format='%x1e%h%x1f%s%x1f%B' "$SHA..main" | python3 -c '
import sys
begin = "<!-- CURSOR_AGENT_PR_BODY_BEGIN -->"
end = "<!-- CURSOR_AGENT_PR_BODY_END -->"
chunks = [c for c in sys.stdin.read().split("\x1e") if c.strip("\n")]
out = []
for c in chunks:
    h, s, body = c.split("\x1f", 2)
    body = body.strip("\n")
    if begin in body and end in body:
        inner = body.split(begin, 1)[1].split(end, 1)[0].strip("\n")
        msg = s.strip("\n") + "\n" + inner
    else:
        msg = body
    out.append(h.strip("\n") + "\n\n" + msg)
print("\n---\n".join(out))
'