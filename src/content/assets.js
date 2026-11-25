/*
 * content/assets.js
 * Files the on-page parts need (the settings page for the panel, the PureFlow icon),
 * asked once from background.js and kept. They arrive as text and data: URLs, so no
 * PureFlow file is ever reachable by a website (no web_accessible_resources): pages
 * can't load our files, and can't probe for them to tell that you use PureFlow.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});
  let asked = null;

  /** Promise of { html, css, icon16, icon32 }. */
  YAS.assets = () => {
    asked ??= chrome.runtime.sendMessage({ type: "assets" }).then((files) => {
      if (!files?.html) throw new Error("no assets");
      return files;
    });
    asked.catch(() => { asked = null; }); // try again next time
    return asked;
  };
})();
