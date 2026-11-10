"""Prepare the selective commitOperationalSync source ZIP locally."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


REVISION = "commitoperationalsync-00010-get"
SOURCE_GENERATION = "1794081152576013"
SOURCE_SHA256 = "60cc67ce8e79ea992a3fc748f3a066ef6e20a8082508ee23a322414c00c65a02"
CHANGED_FILES = (
    "src/services/operational-engagement-validation.js",
    "src/shared/engagement-domain.js",
)
ROOT = Path(__file__).resolve().parents[2]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("active_zip", type=Path)
    parser.add_argument("candidate")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.candidate):
        parser.error("Use the complete Git commit SHA.")
    if sha256(args.active_zip.read_bytes()) != SOURCE_SHA256:
        parser.error(f"Active source does not match {REVISION}.")

    with ZipFile(args.active_zip) as source:
        active = {item.filename: source.read(item) for item in source.infolist() if not item.is_dir()}
    if len(active) != 92 or not all(name in active for name in CHANGED_FILES):
        parser.error("Unexpected active source layout.")
    files = active.copy()
    for name in CHANGED_FILES:
        files[name] = subprocess.check_output(
            ["git", "show", f"{args.candidate}:functions/{name}"], cwd=ROOT
        )
    changed = tuple(name for name in CHANGED_FILES if files[name] != active[name])
    if changed != CHANGED_FILES:
        parser.error("Candidate must supply both renewal files.")

    with ZipFile(args.output, "x") as package:
        for name, data in sorted(files.items()):
            package.writestr(ZipInfo(name), data, compress_type=ZIP_DEFLATED)
    with ZipFile(args.output) as package:
        if {name: package.read(name) for name in package.namelist()} != files:
            raise ValueError("Packaged source verification failed.")
    print(json.dumps({
        "function": "commitOperationalSync",
        "activeRevision": REVISION,
        "activeSourceGeneration": SOURCE_GENERATION,
        "activeSourceSha256": SOURCE_SHA256,
        "candidate": args.candidate,
        "packageSha256": sha256(args.output.read_bytes()),
        "fileCount": len(files),
        "changedFiles": [
            {"path": name, "activeSha256": sha256(active[name]), "candidateSha256": sha256(files[name])}
            for name in changed
        ],
    }, indent=2))


if __name__ == "__main__":
    main()
