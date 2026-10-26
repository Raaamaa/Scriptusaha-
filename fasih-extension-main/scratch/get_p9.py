import json

path = r"C:\Users\ating\.gemini\antigravity-ide\brain\269a922d-34a7-40e8-a158-c0e309afb04e\.system_generated\logs\transcript.jsonl"
with open(path, "r", encoding="utf-8") as f:
    for line in f:
        obj = json.loads(line)
        if obj.get("type") == "USER_INPUT":
            content = obj.get("content", "")
            if "PERAN & KONTEKS" in content:
                with open("scratch/p9_full.txt", "w", encoding="utf-8") as out:
                    out.write(content)
                print("Found and saved prompt 9, length:", len(content))
                break
