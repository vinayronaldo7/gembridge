import os
import glob
import re

ws = r"E:\DeepSeekHarness"

def scan_files():
    print(f"=== PHASE 0 INVENTORY ===")
    print(f"Workspace path: {ws}")
    print(f"Current Working Directory: {os.getcwd()}")
    
    # 1. Top-level files & directories
    print("\n--- TOP-LEVEL FILES & DIRS ---")
    for item in os.listdir(ws):
        full = os.path.join(ws, item)
        is_dir = os.path.isdir(full)
        print(f"  {'[DIR]' if is_dir else '[FILE]'} {item}")

    # 2. .agent files
    print("\n--- .agent/ FILES ---")
    agent_dir = os.path.join(ws, ".agent")
    if os.path.exists(agent_dir):
        for root, dirs, files in os.walk(agent_dir):
            rel = os.path.relpath(root, agent_dir)
            for f in files:
                print(f"  .agent/{'' if rel=='.' else rel+'/'}{f}")

    # 3. .kilo files
    print("\n--- .kilo/ FILES ---")
    kilo_dir = os.path.join(ws, ".kilo")
    if os.path.exists(kilo_dir):
        for root, dirs, files in os.walk(kilo_dir):
            rel = os.path.relpath(root, kilo_dir)
            for f in files:
                print(f"  .kilo/{'' if rel=='.' else rel+'/'}{f}")

    # 4. scripts/ and tests/
    print("\n--- scripts/ & tests/ ---")
    for sub in ["scripts", "tests", "src"]:
        sdir = os.path.join(ws, sub)
        if os.path.exists(sdir):
            for root, dirs, files in os.walk(sdir):
                rel = os.path.relpath(root, ws)
                for f in files:
                    print(f"  {rel}/{f}")

    # 5. Search for P17, P18, P19, P20 references across all text files
    print("\n--- P17 / P18 / P19 / P20 REFERENCES ---")
    patterns = {
        "P17": re.compile(r'\bP17\b|delegation\s+policy', re.I),
        "P18": re.compile(r'\bP18\b', re.I),
        "P19": re.compile(r'\bP19\b', re.I),
        "P20": re.compile(r'\bP20\b|repository\s+separation', re.I),
    }
    
    matches = {k: [] for k in patterns}
    
    for root, dirs, files in os.walk(ws):
        if any(ignored in root for ignored in [".git", "node_modules", "storages", "sessions"]):
            continue
        for f in files:
            if f.endswith(('.md', '.py', '.ts', '.js', '.json', '.yaml', '.yml')):
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, ws)
                try:
                    with open(fp, 'r', encoding='utf-8', errors='ignore') as file:
                        content = file.read()
                    for pkey, pat in patterns.items():
                        if pat.search(content):
                            # Count occurrences
                            count = len(pat.findall(content))
                            matches[pkey].append((rel, count))
                except Exception:
                    pass

    for pkey, flist in matches.items():
        print(f"\n--- {pkey} Matches ({len(flist)} files) ---")
        for rel, count in flist:
            print(f"  {rel} ({count} occurrences)")

if __name__ == "__main__":
    scan_files()

