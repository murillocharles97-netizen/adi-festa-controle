import { auth, db } from "./firebase-config.js";
import { collection, doc, getDocs, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { normalizeFirestoreData } from "./firestore-utils.js";

let memberStop = null;
const businessId = () => String(window.BusinessContext?.get?.().businessId || window.FirebaseSession?.businessId || "");
const callable = async (name, data = {}) => (await window.FirebaseCallable(name, data)).data;
const convert = (snapshot) => normalizeFirestoreData({ id: snapshot.id, ...snapshot.data() });

async function listMembers() {
  const id = businessId();
  if (!id || !window.TeamAccess?.has?.("team.view")) throw Error("Você não tem acesso à equipe.");
  const snapshot = await getDocs(query(collection(db, "businesses", id, "members"), orderBy("name")));
  return snapshot.docs.map(convert);
}
async function listInvites() {
  const id = businessId();
  if (!id || !window.TeamAccess?.has?.("team.view")) throw Error("Você não tem acesso à equipe.");
  const snapshot = await getDocs(collection(db, "businesses", id, "teamInvites"));
  return snapshot.docs.map(convert).filter((item) => item.status === "pending" && new Date(item.expiresAt || 0) > new Date());
}
const createInvite = (input) => callable("createTeamInvite", { businessId: businessId(), ...input });
const updateMember = (uid, input) => callable("updateTeamMember", { businessId: businessId(), uid, ...input });
const disableMember = (uid) => updateMember(uid, { status: "disabled" });
const enableMember = (uid) => updateMember(uid, { status: "active" });
const canonicalAccess = (value = {}) => JSON.stringify({
  role: value.role || "",
  status: value.status || "",
  spaceAccess: value.spaceAccess || "",
  allowedSpaceIds: [...new Set((value.allowedSpaceIds || []).map(String))].sort(),
  permissions: Object.fromEntries(Object.entries(value.permissions || {}).sort(([left], [right]) => left.localeCompare(right))),
});
function watchCurrentMember(onChange) {
  memberStop?.(); memberStop = null;
  const id = businessId(), uid = auth.currentUser?.uid;
  if (!id || !uid) return () => {};
  memberStop = onSnapshot(doc(db, "businesses", id, "members", uid), (snapshot) => {
    if (!snapshot.exists()) {
      if (!snapshot.metadata?.fromCache) onChange?.({ kind: "membership-missing", code: "MEMBERSHIP_MISSING" });
      return;
    }
    const remote = snapshot.data(), current = window.BusinessContext?.get?.().member || {};
    if (remote?.status !== "active") return onChange?.({ kind: "access-disabled", code: "ACCESS_DISABLED" });
    if (current.uid && canonicalAccess(remote) !== canonicalAccess(current)) onChange?.({ kind: "permissions-changed", code: "MEMBERSHIP_CHANGED" });
  }, (error) => {
    const code = String(error?.code || "").replace("firestore/", "");
    onChange?.({ kind: ["unavailable", "deadline-exceeded", "network-request-failed"].includes(code) ? "network-error" : "access-check-failed", code: code || "MEMBERSHIP_LISTENER_FAILED" });
  });
  return () => { memberStop?.(); memberStop = null; };
}
addEventListener("firebase-session-cleared", () => { memberStop?.(); memberStop = null; });
addEventListener("firebase-auth-ready", () => watchCurrentMember((change) => window.FirebaseAuthActions?.handleMembershipChange?.(change)));

window.TeamService = Object.freeze({ listMembers, listInvites, createInvite, updateMember, disableMember, enableMember, watchCurrentMember });
export { listMembers, listInvites, createInvite, updateMember, disableMember, enableMember, watchCurrentMember };
