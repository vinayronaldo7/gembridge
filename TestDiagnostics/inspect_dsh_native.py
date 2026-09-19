import os
import json
import glob

base = r"C:\Users\vinay\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai"

subagent_pkgs = [
    "dsh-tool-subagent",
    "dsh-subagent-in-process-driver",
    "dsh-subagent",
    "dsh-agent",
    "dsh-workflow",
    "dsh-repeat-tool-reminder",
    "dsh-llm-pi-ai",
    "dsh-llm-retry"
]

print("=== INSPECTING NATIVE DSH PACKAGES ===")
for p in subagent_pkgs:
    pdir = os.path.join(base, p)
    if not os.path.exists(pdir):
        print(f"\n[NOT FOUND] {p}")
        continue
    print(f"\n=======================================================")
    print(f"PACKAGE: @deepseek-ai/{p}")
    print(f"Directory: {pdir}")
    
    # Read package.json
    pkg_json = os.path.join(pdir, "package.json")
    with open(pkg_json, "r", encoding="utf-8") as f:
        pdata = json.load(f)
    print(f"Version: {pdata.get('version')}")
    print(f"Main: {pdata.get('main')}")
    print(f"Types: {pdata.get('types')}")
    print(f"Exports: {json.dumps(pdata.get('exports'), indent=2)}")
    print(f"Dependencies: {json.dumps(pdata.get('dependencies', {}), indent=2)}")

    # Read type declarations if available
    types_dir = os.path.join(pdir, "lib", "types")
    if os.path.exists(types_dir):
        print(f"\n--- Type Declaration Files in {types_dir} ---")
        for tf in os.listdir(types_dir):
            if tf.endswith(".d.ts"):
                print(f"\n>>> {tf} <<<")
                with open(os.path.join(types_dir, tf), "r", encoding="utf-8") as file:
                    print(file.read()[:2000])

    # Read main index.js or entry file
    main_file = os.path.join(pdir, pdata.get("main", "lib/index.js"))
    if os.path.exists(main_file):
        print(f"\n--- Main File {main_file} (head) ---")
        with open(main_file, "r", encoding="utf-8") as file:
            print(file.read()[:2000])


