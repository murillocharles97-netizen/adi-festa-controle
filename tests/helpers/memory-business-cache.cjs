// Domain-unit adapter only. Its injected fake Storage lets legacy write-ahead
// tests retain synchronous failure injection. Real IDB/atomicity/quota tests are
// scripts/audit-business-cache-v156.cjs, not this adapter.
module.exports = function install(context) {
  let key = `adiFestaDB_v1:${context.DB.getBusinessId()}`;
  context.DB.businessCache = {
    open: async (next, candidates, empty) => {key=next;const raw=candidates.map(k=>context.localStorage.getItem(k)).find(Boolean);return raw?JSON.parse(raw):empty();},
    stage: (data, next=key) => {key=next;context.localStorage.setItem(key,JSON.stringify(data));},
    release: async()=>{},
  };
  context.DB.flush = async()=>{};
};
