import os
import json

base = r"C:\Users\vinay\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai"

for p in ["dsh-tool-subagent", "dsh-subagent-in-process-driver"]:
    pdir = os.path.join(base, p)
    print(f"\n=======================================================")
    print(f"PACKAGE: @deepseek-ai/{p}")
    
    types_dir = os.path.join(pdir, "lib", "types")
    if os.path.exists(types_dir):
        for tf in os.listdir(types_dir):
            if tf.endswith(".d.ts"):
                print(f"\n>>> {tf} <<<")
                with open(os.path.join(types_dir, tf), "r", encoding="utf-8") as file:
                    print(file.read())

    main_file = os.path.join(pdir, "lib", "index.js")
    if os.path.exists(main_file):
        print(f"\n--- Main File {main_file} ---")
        with open(main_file, "r", encoding="utf-8") as file:
            print(file.read()[:3000])

