// Temporary technical flag. No user preference, secret, storage or entitlement.
export const SALE_TIMING_END = Date.parse('2026-10-25T00:00:00Z');
export function requestsSaleTiming(location, now=Date.now()) {
  return location.origin === 'https://veconi.app.br' && now < SALE_TIMING_END &&
    new URLSearchParams(location.search).get('fiado-timing') === '1';
}
export function permitsSaleTiming(uid, business, member) {
  return Boolean(uid && business?.id === 'adi-festa' && business.ownerId === uid &&
    business.subscription?.planId === 'internal' &&
    ['active','internal'].includes(business.subscription?.status) &&
    member?.role === 'owner' && member.status === 'active');
}
