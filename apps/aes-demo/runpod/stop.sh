#!/usr/bin/env bash
set -euo pipefail
export AES_ENVS=${AES_ENVS:-/opt/aes-envs}
python3 - <<'PY'
import os,signal,time
from pathlib import Path
prefix=os.environ['AES_ENVS'].rstrip('/')+'/'
processes={}
for p in Path('/proc').iterdir():
 if not p.name.isdigit(): continue
 try:
  argv=(p/'cmdline').read_bytes().split(b'\0')
  stat=(p/'stat').read_text().rsplit(')',1)[1].split()
  processes[int(p.name)]=(int(stat[1]),argv)
 except (OSError,ValueError): pass
owned={pid for pid,(_,argv) in processes.items() if argv and argv[0].decode(errors='replace').startswith(prefix)}
while True:
 expanded=owned|{pid for pid,(parent,_) in processes.items() if parent in owned}
 if expanded==owned: break
 owned=expanded
for pid in owned:
 try: os.kill(pid,signal.SIGTERM)
 except ProcessLookupError: pass
print(f'Sent SIGTERM to {len(owned)} AES model processes; saved deployment untouched.')
PY
