import os
import json
import glob

search_dirs = [
    'C:/Users/vinay/AppData/Local/npm-cache',
    'C:/Users/vinay/AppData/Roaming/npm',
    'C:/Users/vinay/.config/kilo',
    'C:/Users/vinay/.local/share/kilo',
    'E:/DeepSeekHarness',
    'E:/tmp',
    'C:/Users/vinay/AppData/Local'
]

print("=== SEARCHING FOR @deepseek-ai PACKAGES ===")
found_pkgs = {}
for base in search_dirs:
    if not os.path.exists(base):
        continue
    for root, dirs, files in os.walk(base):
        if 'package.json' in files and ('dsh-' in root or 'deepseek' in root):
            pkg_json_path = os.path.join(root, 'package.json')
            try:
                with open(pkg_json_path, 'r', encoding='utf-8') as f:
                    pkg_data = json.load(f)
                name = pkg_data.get('name')
                version = pkg_data.get('version')
                main = pkg_data.get('main')
                types = pkg_data.get('types') or pkg_data.get('typings')
                exports = pkg_data.get('exports')
                if name:
                    found_pkgs[name] = {
                        "path": root,
                        "version": version,
                        "main": main,
                        "types": types,
                        "exports": exports,
                        "files": os.listdir(root)
                    }
            except Exception:
                pass

for name, info in sorted(found_pkgs.items()):
    print(f"\nPACKAGE: {name} v{info['version']}")
    print(f"  Path: {info['path']}")
    print(f"  Main: {info['main']}")
    print(f"  Types: {info['types']}")
    print(f"  Exports: {info['exports']}")
    print(f"  Files: {info['files']}")


