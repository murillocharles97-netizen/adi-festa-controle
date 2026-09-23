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
function watchCurrentMember(onDisabled) {
  memberStop?.(); memberStop = null;
  const id = businessId(), uid = auth.currentUser?.uid;
  if (!id || !uid) return () => {};
  memberStop = onSnapshot(doc(db, "businesses", id, "members", uid), (snapshot) => {
    if (!snapshot.exists() || snapshot.data()?.status !== "active") return onDisabled?.();
    const remote = snapshot.data(), current = window.BusinessContext?.get?.().member || {},
      access = (value) => JSON.stringify({ role: value.role, status: value.status, spaceAccess: value.spaceAccess, allowedSpaceIds: value.allowedSpaceIds || [], permissions: value.permissions || {} });
    if (current.uid && access(remote) !== access(current)) onDisabled?.();
  }, (error) => {
    if (["permission-denied", "unauthenticated"].includes(String(error?.code || "").replace("firestore/", ""))) onDisabled?.();
  });
  return () => { memberStop?.(); memberStop = null; };
}
addEventListener("firebase-session-cleared", () => { memberStop?.(); memberStop = null; });
addEventListener("firebase-auth-ready", () => watchCurrentMember(() => window.FirebaseAuthActions?.handleAccessRevoked?.()));

window.TeamService = Object.freeze({ listMembers, listInvites, createInvite, updateMember, disableMember, enableMember, watchCurrentMember });
export { listMembers, listInvites, createInvite, updateMember, disableMember, enableMember, watchCurrentMember };
