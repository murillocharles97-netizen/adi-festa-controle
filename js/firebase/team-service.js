import { auth, db } from "./firebase-config.js";
import { collection, doc, getDocs, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { normalizeFirestoreData } from "./firestore-utils.js";

let memberStop = null, memberEpoch = 0;
const businessId = () => String(window.BusinessContext?.get?.().businessId || window.FirebaseSession?.businessId || "");
const callable = async (name, data = {}) => (await window.FirebaseCallable(name, data)).data;
const convert = (snapshot) => normalizeFirestoreData({ ...snapshot.data(), id: snapshot.id });

async function listMembers() {
  const id = businessId();
  if (!id || !window.TeamAccess?.has?.("team.view")) throw Error("Você não tem acesso à equipe.");
  const snapshot = await getDocs(query(collection(db, "businesses", id, "members"), orderBy("name")));
  // The member document ID is the canonical Auth UID, including old records
  // without an inline uid. Never trust an inline alias to select the target.
  return snapshot.docs.map(item => ({ ...convert(item), uid: item.id }));
}
async function listInvites() {
  const id = businessId();
  if (!id || !window.TeamAccess?.has?.("team.view")) throw Error("Você não tem acesso à equipe.");
  const snapshot = await getDocs(collection(db, "businesses", id, "teamInvites"));
  return snapshot.docs.map(convert).filter((item) => item.status === "pending" && new Date(item.expiresAt || 0) > new Date());
}
async function mutateTeam(name,input){
  if(window.AdiFestaBuild?.permissionsV2EditingPaused)throw Error('A edição de permissões está pausada para manutenção. Os acessos atuais e as operações comerciais foram preservados.');
  window.TeamAccess?.assert?.('team.manage');
  if(!window.TeamAccess?.has?.('team.manage'))throw window.VeconiPermissionPolicy.denied('team.manage');
  const token=window.TeamAccess?.captureSession?.(),id=businessId();
  const result=await callable(name,{...input,businessId:id});
  window.TeamAccess?.assertSession?.(token);
  return result;
}
const createInvite = input => mutateTeam("createTeamInvite", input);
const updateMember = (uid,input) => mutateTeam("updateTeamMember", {...input,uid});
const disableMember = (uid) => updateMember(uid, { status: "disabled" });
const enableMember = (uid) => updateMember(uid, { status: "active" });
const canonicalAccess = (value = {}) => JSON.stringify({
  role: value.role || "",
  status: value.status || "",
  spaceAccess: value.spaceAccess || "",
  allowedSpaceIds: [...new Set((value.allowedSpaceIds || []).map(String))].sort(),
  permissions: Object.fromEntries(Object.entries(value.permissions || {}).sort(([left], [right]) => left.localeCompare(right))),
  permissionsVersion: value.permissionsVersion || 1,
});
function watchCurrentMember(onChange) {
  const epoch=++memberEpoch;
  memberStop?.(); memberStop = null;
  const id = businessId(), uid = auth.currentUser?.uid;
  if (!id || !uid) return () => {};
  memberStop = onSnapshot(doc(db, "businesses", id, "members", uid), (snapshot) => {
    if(epoch!==memberEpoch||id!==businessId()||uid!==auth.currentUser?.uid)return;
    if (!snapshot.exists()) {
      if (!snapshot.metadata?.fromCache) onChange?.({ kind: "membership-missing", code: "MEMBERSHIP_MISSING" });
      return;
    }
    const remote = snapshot.data(), current = window.BusinessContext?.get?.().member || {};
    if (remote?.status !== "active") return onChange?.({ kind: "access-disabled", code: "ACCESS_DISABLED" });
    if (current.uid && canonicalAccess(remote) !== canonicalAccess(current)) {
      window.BusinessContext?.suspendPermissions?.();
      onChange?.({ kind: "permissions-changed", code: "MEMBERSHIP_CHANGED" });
    }
  }, (error) => {
    if(epoch!==memberEpoch||id!==businessId()||uid!==auth.currentUser?.uid)return;
    const code = String(error?.code || "").replace("firestore/", "");
    onChange?.({ kind: ["unavailable", "deadline-exceeded", "network-request-failed"].includes(code) ? "network-error" : "access-check-failed", code: code || "MEMBERSHIP_LISTENER_FAILED" });
  });
  const stop=memberStop;
  return () => { stop?.(); if(epoch===memberEpoch){memberEpoch++;memberStop=null;} };
}
addEventListener("firebase-session-cleared", () => { memberEpoch++; memberStop?.(); memberStop = null; });
addEventListener("firebase-auth-ready", () => watchCurrentMember((change) => window.FirebaseAuthActions?.handleMembershipChange?.(change)));

window.TeamService = Object.freeze({ listMembers, listInvites, createInvite, updateMember, disableMember, enableMember, watchCurrentMember });
export { listMembers, listInvites, createInvite, updateMember, disableMember, enableMember, watchCurrentMember };
