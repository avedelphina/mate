#!/usr/bin/env python3
"""Count the words of a draft, without its review comments.

    scripts/count-words.py draft/document.md

An example of a script of a project. Mate runs it when you press its button
in the workflow pane, with no agent, in a context you trust.
"""
import re
import sys
from pathlib import Path

for name in sys.argv[1:] or ["draft/document.md"]:
    text = Path(name).read_text(encoding="utf-8")
    prose = re.sub(r"<!-- @comment.*?-->", "", text, flags=re.S)
    print(f"{name}: {len(prose.split())} words")
