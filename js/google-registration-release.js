// V218 commercial UI. The broker's signed identity, origin and rollout policy
// remain authoritative; these switches never grant business membership.
export const GOOGLE_RELEASE=Object.freeze({publicEnabled:true,qaEnabled:true,newRegistrations:true});
export function googleEntryPolicy(href){
 const url=new URL(href),commercial=GOOGLE_RELEASE.publicEnabled&&url.origin==='https://veconi.app.br',qa=GOOGLE_RELEASE.qaEnabled&&url.origin==='https://veconi.app.br'&&url.searchParams.get('google-qa')==='v216';
 return Object.freeze({enabled:commercial||qa,allowSignup:commercial&&GOOGLE_RELEASE.newRegistrations,restrictedPilot:!commercial});
}
