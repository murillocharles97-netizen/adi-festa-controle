((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MobileNavigationGesture = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const EDGE_ZONE = 28;
  const THRESHOLD = 64;
  const DIRECTION_RATIO = 1.2;

  function horizontalIntent(deltaX, deltaY) {
    return Math.abs(deltaX) >= 10 && Math.abs(deltaX) > Math.abs(deltaY) * DIRECTION_RATIO;
  }

  function classifySwipe({
    startX = 0,
    startY = 0,
    endX = 0,
    endY = 0,
    drawerOpen = false,
    pointerType = "touch",
    safeLeft = 0,
    horizontalOwner = false,
  } = {}) {
    if (pointerType === "mouse") return null;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    if (!horizontalIntent(deltaX, deltaY)) return null;
    if (drawerOpen) return deltaX <= -THRESHOLD ? "close" : null;
    if (horizontalOwner || startX > Math.max(0, safeLeft) + EDGE_ZONE) return null;
    return deltaX >= THRESHOLD ? "open" : null;
  }

  return Object.freeze({ EDGE_ZONE, THRESHOLD, DIRECTION_RATIO, horizontalIntent, classifySwipe });
});
