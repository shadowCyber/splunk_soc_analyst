#!/usr/bin/env python3
"""
sync_runbooks.py — Bundle .md runbooks from your runbooks repo into
appserver/static/runbooks_data.json so the Splunk viewer can load them
without any KV store / auth dependency.

Usage:
  python3 scripts/sync_runbooks.py --src /path/to/runbooks/repo
  python3 scripts/sync_runbooks.py --src /path/to/runbooks/repo --out /custom/output.json

The script walks --src for *.md files.  Frontmatter (YAML between ---) is
parsed for metadata; any fields found there override auto-detected defaults.

Supported frontmatter keys:
  title, category, severity_scope, author, version, tags, active, last_updated

Example frontmatter:
  ---
  title: Phishing Email Response Playbook
  category: phishing
  severity_scope: high
  author: SOC Team
  version: 1.0
  tags: phishing, T1566
  ---
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT  = SCRIPT_DIR.parent
DEFAULT_OUT = REPO_ROOT / "etc" / "shcluster" / "apps" / "soc_triage_app" / "appserver" / "static" / "runbooks_data.json"

FRONTMATTER_RE = re.compile(r'^\s*---\s*\n(.*?)\n---\s*\n', re.DOTALL)


def parse_frontmatter(text):
    """Return (metadata_dict, body_text)."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            k, _, v = line.partition(':')
            meta[k.strip()] = v.strip()
    body = text[m.end():]
    return meta, body


def slugify(s):
    return re.sub(r'[^\w]+', '_', s.lower()).strip('_')


def md_to_runbook(md_path: Path):
    text = md_path.read_text(encoding='utf-8')
    meta, body = parse_frontmatter(text)

    # Full content includes frontmatter-stripped body
    content_md = body.strip()

    # Derive title: frontmatter > first h1 > filename
    title = meta.get('title', '')
    if not title:
        h1 = re.search(r'^#\s+(.+)$', content_md, re.MULTILINE)
        title = h1.group(1).strip() if h1 else md_path.stem.replace('_', ' ').replace('-', ' ').title()

    key = slugify(md_path.stem)

    mtime = datetime.fromtimestamp(md_path.stat().st_mtime, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    return {
        '_key':           key,
        'title':          title,
        'category':       meta.get('category', 'general'),
        'severity_scope': meta.get('severity_scope', 'all'),
        'author':         meta.get('author', ''),
        'version':        meta.get('version', '1.0'),
        'tags':           meta.get('tags', ''),
        'active':         meta.get('active', 'true'),
        'last_updated':   meta.get('last_updated', mtime),
        'content_md':     content_md,
        'source':         'git',  # marks as git-managed (read-only in UI)
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--src',  required=True, help='Path to repo / folder containing .md runbook files (searched recursively)')
    p.add_argument('--out',  default=str(DEFAULT_OUT), help=f'Output JSON path (default: {DEFAULT_OUT})')
    p.add_argument('--deploy', action='store_true', help='Also copy output to /Applications/Splunk/etc/apps/soc_triage_app/appserver/static/')
    args = p.parse_args()

    src = Path(args.src).expanduser().resolve()
    if not src.exists():
        sys.exit(f"ERROR: --src path does not exist: {src}")

    md_files = sorted(src.rglob('*.md'))
    if not md_files:
        sys.exit(f"ERROR: no .md files found under {src}")

    runbooks = []
    for f in md_files:
        try:
            rb = md_to_runbook(f)
            runbooks.append(rb)
            print(f"  + {rb['_key']:40s}  {rb['title']}")
        except Exception as e:
            print(f"  ! SKIP {f.name}: {e}", file=sys.stderr)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(runbooks, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"\nWrote {len(runbooks)} runbooks → {out}")

    if args.deploy:
        import shutil
        dest = Path('/Applications/Splunk/etc/apps/soc_triage_app/appserver/static/runbooks_data.json')
        shutil.copy2(out, dest)
        print(f"Deployed → {dest}")
        print("Reload app:  curl -ks -u admin:PASSWORD https://localhost:8089/services/apps/local/soc_triage_app/_reload -X POST")


if __name__ == '__main__':
    main()
