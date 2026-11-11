"""Package only the customer-directory change for commitOperationalSync."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[2]
ACTIVE = "61db08b81f8bd06225162a91f203db2ff5e9933bf1c508c0bb06ea81e42d83c6"
COMMIT = "src/services/operational-commit-service.js"
DIRECTORY = "src/services/customer-directory-service.js"
IMPORT = "const {validateEngagement}=require('./operational-engagement-validation');"
VALIDATE = "   await validate(tx,c,item,attemptWrites,plan,get,writes,historyAccount);"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def insert(text, anchor, line):
    if text.count(anchor) != 1:
        raise ValueError("Unexpected deployed commitOperationalSync source")
    return text.replace(anchor, anchor + "\n" + line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("active_zip", type=Path)
    parser.add_argument("candidate")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.candidate):
        parser.error("Provide the full candidate SHA")
    if sha(args.active_zip.read_bytes()) != ACTIVE:
        parser.error("Source must match the active commitoperationalsync-00011-ruy")
    def blob(name):
        return subprocess.check_output(["git", "show", f"{args.candidate}:functions/{name}"], cwd=ROOT)

    with ZipFile(args.active_zip) as archive:
        base = {entry.filename: archive.read(entry) for entry in archive.infolist() if not entry.is_dir()}
    assert len(base) == 92 and DIRECTORY not in base
    code = blob(COMMIT).decode()
    new_import = next(line for line in code.splitlines() if "require('./customer-directory-service')" in line)
    hook = next(line for line in code.splitlines() if "await validateCustomerDirectoryWrites(" in line)
    route_start = code.index("  if(request.data?.kind==='customer_directory')")
    route_end = code.index("  if(!paymentRecovery", route_start)
    route = code[route_start:route_end].rstrip("\n")
    original = base[COMMIT].decode()
    updated = insert(original, IMPORT, new_import)
    updated = insert(updated, " async function commit(request,{priorSale=null}={}){", route)
    updated = insert(updated, VALIDATE, hook)
    name_filter = ".filter(n=>n!=='processedOperations')"
    assert updated.count(name_filter) == 1
    updated = updated.replace(name_filter, ".filter(n=>n!=='processedOperations'&&n!=='customerPhoneKeys')")
    files = {**base, COMMIT: updated.encode(), DIRECTORY: blob(DIRECTORY)}
    assert all(b"payment_recovery_review" not in data and b"payment_recovery_apply" not in data for data in files.values())
    with ZipFile(args.output, "x") as archive:
        for name, data in sorted(files.items()):
            archive.writestr(ZipInfo(name), data, compress_type=ZIP_DEFLATED)
    with ZipFile(args.output) as archive:
        assert {name: archive.read(name) for name in archive.namelist()} == files
    print(json.dumps({
        "function": "commitOperationalSync",
        "activeRevision": "commitoperationalsync-00011-ruy",
        "activeSourceSha256": ACTIVE,
        "candidate": args.candidate,
        "packageSha256": sha(args.output.read_bytes()),
        "files": len(files),
        "identical": 91,
        "modified": [COMMIT],
        "added": [DIRECTORY],
    }, indent=2))


if __name__ == "__main__":
    main()
