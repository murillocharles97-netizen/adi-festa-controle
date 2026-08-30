(() => {
  "use strict";

  const readMeta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.content?.trim() || "",
    rawCommit = readMeta("adi-festa-build"),
    rawTime = readMeta("adi-festa-build-time"),
    validCommit = /^[0-9a-f]{7,40}$/i.test(rawCommit),
    validTime = rawTime && !rawTime.includes("{{") && !Number.isNaN(Date.parse(rawTime)),
    commit = validCommit ? rawCommit : "local",
    shortCommit = validCommit ? rawCommit.slice(0, 7) : "local",
    builtAt = validTime ? rawTime : new Date(document.lastModified).toISOString();

  window.AdiFestaBuild = Object.freeze({
    commit,
    shortCommit,
    builtAt,
    release: "111",
  });

  if (!window.__adiFestaBuildLogged) {
    window.__adiFestaBuildLogged = true;
    console.info(`[Adi Festa] Build ${shortCommit} carregado`);
  }
})();
