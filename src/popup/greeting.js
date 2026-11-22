/*
 * popup/greeting.js
 * A friendly hello in the popup, based on the time of day.
 * Messages rotate: each time you open the popup you get the next one.
 * Pure functions only (no storage, no DOM), so they are easy to test.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const PERIODS = {
    morning: {
      hello: (name) => (name ? `Good morning, ${name}` : "Good morning"),
      messages: [
        "Fresh start. No ads today.",
        "Coffee and clean videos.",
        "Your feed, minus the ads.",
        "Ready when you are.",
        "Have a calm morning.",
      ],
    },
    afternoon: {
      hello: (name) => (name ? `Good afternoon, ${name}` : "Good afternoon"),
      messages: [
        "No breaks, just videos.",
        "Keep it smooth this afternoon.",
        "Ads stay out. You stay in.",
        "Pick something good.",
        "Enjoy your afternoon watch.",
      ],
    },
    evening: {
      hello: (name) => (name ? `Good evening, ${name}` : "Good evening"),
      messages: [
        "Time to unwind.",
        "Sit back. We've got the ads.",
        "Relax, nothing will interrupt you.",
        "Enjoy your evening.",
        "A quiet evening watch ahead.",
      ],
    },
    night: {
      hello: (name) => (name ? `Up late, ${name}?` : "Up late?"),
      messages: [
        "No ads to wake you up.",
        "Quiet videos for a quiet night.",
        "One more video? Go on.",
        "Don't stay up too late.",
        "Night mode for your feed.",
      ],
    },
  };

  /** 5:00-11:59 morning, 12:00-16:59 afternoon, 17:00-20:59 evening, else night. */
  function periodFor(hour) {
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 21) return "evening";
    return "night";
  }

  /**
   * Build the greeting.
   * @param {Date} now
   * @param {string} name   optional, from the popup's "Add your name"
   * @param {number} turn   how many times the popup was opened; picks the message
   */
  function build(now, name, turn) {
    const period = PERIODS[periodFor(now.getHours())];
    const cleanName = (name || "").trim().split(/\s+/)[0] || ""; // first name only
    const message = period.messages[Math.abs(turn) % period.messages.length];
    return { title: period.hello(cleanName), message };
  }

  YAS.greeting = { build, periodFor, PERIODS };
})();
