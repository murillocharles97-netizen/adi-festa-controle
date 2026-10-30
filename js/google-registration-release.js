// Controlled V216 release. These are UI switches, never authorization.
// The broker still requires the server-side pilot email/sub allowlist.
export const GOOGLE_RELEASE=Object.freeze({publicEnabled:false,qaEnabled:true,newRegistrations:false});
export function googleEntryPolicy(href){
 const url=new URL(href),qa=GOOGLE_RELEASE.qaEnabled&&url.origin==='https://veconi.app.br'&&url.searchParams.get('google-qa')==='v216';
 return Object.freeze({enabled:GOOGLE_RELEASE.publicEnabled||qa,allowSignup:GOOGLE_RELEASE.publicEnabled&&GOOGLE_RELEASE.newRegistrations,restrictedPilot:!GOOGLE_RELEASE.publicEnabled});
}
