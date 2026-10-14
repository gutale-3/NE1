"""Stage a week's pack for the "NE Social Media" page (an Artifact on claude.ai).

    python3 tools/social/stage.py <pack folder> <stage folder> [current weeks.json]

Copies the pack's images and videos to <stage>/weeks/<monday>/ and writes
<stage>/weeks.json: this week first, then the weeks already on the page
(from the published weeks.json, if given), newest first. Publish the page
(tools/social/page.html) with every staged file under its relative path.
"""
import json
import pathlib
import shutil
import sys

pack, stage = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
current = json.loads(pathlib.Path(sys.argv[3]).read_text()) if len(sys.argv) > 3 and pathlib.Path(sys.argv[3]).exists() else []
week = json.loads((pack / "captions.json").read_text())
folder = stage / "weeks" / week["monday"]
folder.mkdir(parents=True, exist_ok=True)
for post in week["posts"]:
    shutil.copy(pack / post["file"], folder / post["file"])
    post["path"] = f"weeks/{week['monday']}/{post['file']}"
weeks = [week] + [w for w in current if w.get("monday") != week["monday"]]
weeks.sort(key=lambda w: w["monday"], reverse=True)
(stage / "weeks.json").write_text(json.dumps(weeks, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({f"weeks/{week['monday']}/{p['file']}": str(folder / p['file']) for p in week["posts"]}))
