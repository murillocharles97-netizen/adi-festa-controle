(function () {
  "use strict";

  const query = matchMedia("(prefers-reduced-motion: reduce)"),
    EASING = "cubic-bezier(.2,.8,.2,1)",
    durations = { fast: 150, normal: 210, sheet: 260, flight: 330 };
  const reduced = () => query.matches;
  const animate = (element, keyframes, options = {}) => {
    if (!element || reduced() || typeof element.animate !== "function") return null;
    return element.animate(keyframes, {
      duration: durations.normal,
      easing: EASING,
      fill: "both",
      ...options,
    });
  };
  function capture(root, selector, keyAttribute) {
    const positions = new Map();
    root?.querySelectorAll(selector).forEach((element) => {
      const key = element.getAttribute(keyAttribute);
      if (key) positions.set(key, element.getBoundingClientRect());
    });
    return positions;
  }
  function flip(root, previous, selector, keyAttribute, options = {}) {
    if (!root || reduced()) return [];
    const animations = [];
    root.querySelectorAll(selector).forEach((element, index) => {
      const key = element.getAttribute(keyAttribute),
        before = previous?.get(key),
        after = element.getBoundingClientRect();
      if (before) {
        const dx = before.left - after.left,
          dy = before.top - after.top,
          sx = before.width && after.width ? before.width / after.width : 1,
          sy = before.height && after.height ? before.height / after.height : 1;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
          const animation = animate(
            element,
            [
              { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.82 },
              { transform: "translate(0,0) scale(1,1)", opacity: 1 },
            ],
            { duration: options.duration || 230, delay: Math.min(index, 8) * 8 },
          );
          if (animation) animations.push(animation);
        }
      } else {
        const animation = animate(
          element,
          [
            { transform: "translateY(8px)", opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: options.duration || durations.normal, delay: Math.min(index, 8) * 12 },
        );
        if (animation) animations.push(animation);
      }
    });
    root.dataset.motionActive = options.name || "flip";
    Promise.allSettled(animations.map((item) => item.finished)).finally(() => {
      if (root.isConnected) delete root.dataset.motionActive;
    });
    return animations;
  }
  function press(element) {
    return animate(
      element,
      [{ transform: "scale(1)" }, { transform: "scale(.985)" }, { transform: "scale(1)" }],
      { duration: durations.fast },
    );
  }
  function pop(element) {
    return animate(
      element,
      [{ transform: "scale(1)" }, { transform: "scale(1.16)" }, { transform: "scale(1)" }],
      { duration: 190 },
    );
  }
  function counter(element, from, to) {
    if (!element) return null;
    const version = String((Number(element.dataset.motionCounterVersion) || 0) + 1);
    element.dataset.motionCounterVersion = version;
    if (reduced() || from === to) {
      element.textContent = to;
      return null;
    }
    element.textContent = "";
    element.classList.add("motion-counter");
    const oldValue = document.createElement("span"),
      newValue = document.createElement("span");
    oldValue.textContent = from;
    newValue.textContent = to;
    newValue.className = "motion-counter-next";
    element.append(oldValue, newValue);
    const oldAnimation = animate(oldValue, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-75%)", opacity: 0 }], { duration: 190 }),
      newAnimation = animate(newValue, [{ transform: "translateY(75%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 190 });
    Promise.allSettled([oldAnimation?.finished, newAnimation?.finished].filter(Boolean)).finally(() => {
      if (!element.isConnected || element.dataset.motionCounterVersion !== version) return;
      element.classList.remove("motion-counter");
      element.textContent = to;
    });
    return newAnimation;
  }
  function fly(source, target, options = {}) {
    if (!source || !target || reduced()) return null;
    const from = source.getBoundingClientRect(),
      to = target.getBoundingClientRect(),
      flight = document.createElement("span"),
      image = source.querySelector("img");
    flight.className = "cart-flight";
    flight.dataset.motionFlight = "active";
    if (image?.currentSrc || image?.src) {
      const clone = document.createElement("img");
      clone.src = image.currentSrc || image.src;
      clone.alt = "";
      flight.append(clone);
    } else {
      flight.textContent = options.fallback || source.textContent?.trim().slice(0, 2) || "+";
    }
    Object.assign(flight.style, {
      left: `${from.left + from.width / 2 - 22}px`,
      top: `${from.top + from.height / 2 - 22}px`,
    });
    document.body.append(flight);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2),
      dy = to.top + to.height / 2 - (from.top + from.height / 2),
      animation = animate(
        flight,
        [
          { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
          { transform: `translate3d(${dx * 0.48}px,${dy * 0.28 - 38}px,0) scale(.72)`, opacity: 0.92, offset: 0.52 },
          { transform: `translate3d(${dx}px,${dy}px,0) scale(.2)`, opacity: 0 },
        ],
        { duration: durations.flight },
      );
    animation?.finished.finally(() => {
      flight.remove();
      pop(target);
    });
    return animation;
  }
  function sheet(element) {
    return animate(element, [{ transform: "translateY(28px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: durations.sheet });
  }
  function feedback(element, type = "success") {
    element?.classList.remove("motion-success", "motion-error");
    element?.classList.add(type === "error" ? "motion-error" : "motion-success");
    const animation = animate(element, type === "error"
      ? [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }]
      : [{ transform: "scale(1)" }, { transform: "scale(.985)" }, { transform: "scale(1)" }], { duration: 180 });
    animation?.finished.finally(() => element?.classList.remove("motion-success", "motion-error"));
    return animation;
  }

  window.MobileMotion = { EASING, durations, reduced, animate, capture, flip, press, pop, counter, fly, sheet, feedback };
})();
