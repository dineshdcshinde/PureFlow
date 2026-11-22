/*
 * content/features/focus.js
 * Focus mode: hide Shorts, comments, recommendations and end screens.
 *
 * Only flips attributes on <html>. The actual hiding is plain CSS in styles/hide.css,
 * which is the cheapest possible way: no timers, no observers.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  // setting name -> attribute on <html> (hide.css reads these)
  const TOGGLES = {
    hideShorts: "data-yas-hide-shorts",
    hideComments: "data-yas-hide-comments",
    hideRelated: "data-yas-hide-related",
    hideEndScreens: "data-yas-hide-endscreens",
  };

  YAS.focus = {
    apply(settings) {
      const root = document.documentElement;
      for (const [setting, attribute] of Object.entries(TOGGLES)) {
        root.toggleAttribute(attribute, Boolean(settings[setting]));
      }
    },
    clear() {
      for (const attribute of Object.values(TOGGLES)) document.documentElement.removeAttribute(attribute);
    },
  };
})();
