"""Package the scoped customer directory read for readOperationalWorkspace."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ACTIVE = "8cfde88fdae680dd3f809fe59ee7fb0a24a68c75e9a78812ecf09cbc89c65e3b"
FILE = "src/services/operational-read-service.js"
COMPAT = """ const customerScoped=(v,c)=>scoped(v,c)||v&&(!v.businessId||v.businessId===c.bid)&&gen(v)===gen(c.business)&&
  v.active!==false&&v.ativo!==false&&!v.deletedAt&&Array.isArray(v.customerSpaceIds)&&v.customerSpaceIds.some(id=>c.ids.includes(id));
 const project=(col,v,c)=>{
  if(col!=='clients')return Privacy.sanitize(col,v);
  const directoryOnly=!scoped(v,c);
  const output=directoryOnly?Privacy.pick(v,['id','businessId','workspaceGeneration','nome','telefone','active','ativo']):Privacy.sanitize(col,v);
  if(Array.isArray(v.customerSpaceIds))output.customerSpaceIds=v.customerSpaceIds.filter(id=>c.spaces.some(space=>space.id===id));
  output.customerDirectoryOnly=directoryOnly;
  return output;
 };
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("active_zip", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.active_zip.read_bytes()).hexdigest() != ACTIVE:
        parser.error("Source must match readoperationalworkspace-00001-hik")
    with ZipFile(args.active_zip) as archive:
        files = {entry.filename: archive.read(entry) for entry in archive.infolist() if not entry.is_dir()}
    assert len(files) == 81 and FILE in files
    original = files[FILE].decode()
    anchor = " const current=(v,c,field='data')"
    assert original.count(anchor) == 1
    updated = original.replace(anchor, COMPAT + anchor)
    for old, new in [
        ("if(!scoped(v,c))throw new HttpsError", "if(!(col==='clients'?customerScoped(v,c):scoped(v,c)))throw new HttpsError"),
        ("if(!scoped(v,c))continue;if(temporal", "if(!(col==='clients'?customerScoped(v,c):scoped(v,c)))continue;if(temporal"),
        ("record:Privacy.sanitize(col,{id:d.id,...v})", "record:project(col,{id:d.id,...v},c)"),
        ("const clean=Privacy.sanitize(col,v);if(clean)", "const clean=project(col,v,c);if(clean)"),
    ]:
        assert updated.count(old) == 1, old
        updated = updated.replace(old, new)
    files[FILE] = updated.encode()
    with ZipFile(args.output, "x") as archive:
        for name, data in sorted(files.items()):
            archive.writestr(ZipInfo(name), data, compress_type=ZIP_DEFLATED)
    with ZipFile(args.output) as archive:
        assert {name: archive.read(name) for name in archive.namelist()} == files
    print(json.dumps({
        "function": "readOperationalWorkspace",
        "activeRevision": "readoperationalworkspace-00001-hik",
        "activeSourceSha256": ACTIVE,
        "packageSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "files": len(files),
        "identical": 80,
        "modified": [FILE],
    }, indent=2))


if __name__ == "__main__":
    main()
