/*
 * content/features/screenshot.js
 * Save the frame on screen as a PNG, straight to your Downloads folder.
 * Made on your computer; nothing is uploaded.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  /** "My video: part 2" at 83s -> "My video part 2 1-23.png" */
  function fileName(title, seconds) {
    const clean = String(title || "video").replace(/\s*-\s*YouTube$/, "")
      .replace(/^\(\d+\)\s*/, "")              // "(3) title": notification count
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "") // not allowed in file names
      .replace(/\s+/g, " ").trim().slice(0, 80) || "video";
    const time = YAS.loop ? YAS.loop.clock(seconds).replace(/:/g, "-") : String(Math.floor(seconds));
    return `${clean} ${time}.png`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  YAS.screenshot = {
    /** Returns a Promise<boolean>: true when the picture was saved. */
    save(video) {
      return new Promise((resolve) => {
        if (!video || !video.videoWidth || !video.videoHeight) return resolve(false);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) return resolve(false);
            download(blob, fileName(document.title, video.currentTime));
            resolve(true);
          }, "image/png");
        } catch (e) {
          resolve(false); // e.g. a protected video that can't be drawn
        }
      });
    },
    fileName,
  };
})();
