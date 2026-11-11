"""Package the scoped customer directory read for readOperationalWorkspace."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ACTIVE = "8cfde88fdae680dd3f809fe59ee7fb0a24a68c75e9a78812ecf09cbc89c65e3b"
FILE = "src/services/operational-read-service.js"
COMPAT = """ async function customerLinkProofs(tx,c,docs){
  const refs=docs.filter(doc=>Array.isArray(doc.data()?.customerSpaceIds)&&doc.data().customerSpaceIds.length)
   .map(doc=>c.root.collection('customerDirectoryLinks').doc(doc.id));
  const proofs=refs.length?await tx.getAll(...refs):[];
  return new Map(proofs.flatMap(doc=>{
   const v=doc.data();
   return v?.clientId===doc.id&&v.businessId===c.bid&&gen(v)===gen(c.business)&&Array.isArray(v.spaceIds)
    ?[[doc.id,v.spaceIds.filter(id=>c.spaces.some(space=>space.id===id))]]:[];
  }));
 }
 const customerScoped=(v,c,links)=>scoped(v,c)||v&&(!v.businessId||v.businessId===c.bid)&&gen(v)===gen(c.business)&&
  v.active!==false&&v.ativo!==false&&!v.deletedAt&&links?.some(id=>c.ids.includes(id));
 const project=(col,v,c,links)=>{
  if(col!=='clients')return Privacy.sanitize(col,v);
  const directoryOnly=!scoped(v,c);
  const output=directoryOnly?Privacy.pick(v,['id','businessId','workspaceGeneration','nome','telefone','active','ativo']):Privacy.sanitize(col,v);
  if(links?.length)output.customerSpaceIds=links;
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
        (
            "const v=(await tx.get(c.root.collection(col).doc(d.id))).data();if(!v)return envelope(c,{record:null});if(!scoped(v,c))",
            "const doc=await tx.get(c.root.collection(col).doc(d.id)),v=doc.data();if(!v)return envelope(c,{record:null});"
            "const links=col==='clients'?(await customerLinkProofs(tx,c,[doc])).get(doc.id):undefined;"
            "if(!(col==='clients'?customerScoped(v,c,links):scoped(v,c)))",
        ),
        ("const rows=await tx.get(q.limit(max)),items=[];", "const rows=await tx.get(q.limit(max)),items=[],proofs=col==='clients'?await customerLinkProofs(tx,c,rows.docs):null;"),
        ("if(!scoped(v,c))continue;if(temporal", "const links=proofs?.get(doc.id);if(!(col==='clients'?customerScoped(v,c,links):scoped(v,c)))continue;if(temporal"),
        ("record:Privacy.sanitize(col,{id:d.id,...v})", "record:project(col,{...v,id:d.id},c,links)"),
        ("const clean=Privacy.sanitize(col,v);if(clean)", "const clean=project(col,col==='clients'?{...v,id:doc.id}:v,c,links);if(clean)"),
        (
            "const client=(await tx.get(c.root.collection('clients').doc(d.customerId))).data();if(!scoped(client,c))throw new HttpsError('permission-denied','Cliente indisponível no espaço autorizado.');\n"
            "  const result={client:Privacy.sanitize('clients',{id:d.customerId,...client}),sales:[],campaignProgress:[],campaignEvents:[],customerSubscriptions:[]};",
            """const doc=await tx.get(c.root.collection('clients').doc(d.customerId)),client=doc.data();
  const origin=scoped(client,c);
  const links=d.purpose==='checkout'?(await customerLinkProofs(tx,c,[doc])).get(doc.id):undefined;
  const linkedCheckout=!origin&&d.purpose==='checkout'&&links?.includes(d.spaceId)&&
   c.ids.includes(d.spaceId)&&c.spaces.some(space=>space.id===d.spaceId&&space.capabilities?.sales===true)&&customerScoped(client,c,links);
  if(!origin&&!linkedCheckout)throw new HttpsError('permission-denied','Cliente indisponível no espaço autorizado.');
  const selectedClient={...client,id:doc.id};
  const result={client:d.purpose==='checkout'?project('clients',selectedClient,c,links):Privacy.sanitize('clients',selectedClient),sales:[],campaignProgress:[],campaignEvents:[],customerSubscriptions:[]};
  const benefitsQuery=col=>{
   const q=c.root.collection(col).where('clientId','==',doc.id);
   return (linkedCheckout?q.where('spaceId','==',d.spaceId):q).limit(301);
  };""",
        ),
        ("c.root.collection(col).where('clientId','==',d.customerId).limit(301)", "benefitsQuery(col)"),
        ("c.root.collection('campaignEvents').where('clientId','==',d.customerId).limit(301)", "benefitsQuery('campaignEvents')"),
    ]:
        old = old.replace("\n", "\r\n")
        assert updated.count(old) == 1, old
        updated = updated.replace(old, new.replace("\n", "\r\n"))
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
