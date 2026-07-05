import sys
from pathlib import Path

# 让 `import bpt_v2t` 可用(包在 projects/bpt-v2t/ 下,非顶层)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
