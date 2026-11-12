// Transcript output is independent of YouTube's changing page markup.
globalThis.WAYPOINTS_TRANSCRIPT = (() => {
  const formats = [
    {
      id: "markdown-linked",
      label: "Markdown with linked timestamps",
      extension: "md",
      mime: "text/markdown",
      use: "Obsidian notes and research",
      description:
        "Keep the video title and source, with a clickable timestamp for each passage. Paste into Obsidian to jump straight back to that moment in YouTube.",
      example: "[1:30](https://www.youtube.com/watch?v=…&t=90s) · The next topic.",
    },
    {
      id: "markdown",
      label: "Markdown with bold timestamps",
      extension: "md",
      mime: "text/markdown",
      use: "Notes in the style of Obsidian Web Clipper",
      description:
        "Keep the video title, source URL, and bold timestamps beside each passage. Times are easy to scan but are not links.",
      example: "**1:30** · The next topic.",
    },
    {
      id: "text-timed",
      label: "Plain text with timestamps",
      extension: "txt",
      mime: "text/plain",
      use: "Text editors, email, and general clipboard use",
      description:
        "Readable timestamps and transcript text without Markdown formatting. Includes the video title and source URL.",
      example: "1:30 · The next topic.",
    },
    {
      id: "text",
      label: "Plain text without timestamps",
      extension: "txt",
      mime: "text/plain",
      use: "Continuous reading and text processing",
      description:
        "Only the spoken text, one transcript segment per line. Useful when timing and source metadata would get in the way.",
      example: "The next topic.",
    },
    {
      id: "srt",
      label: "SRT subtitles",
      extension: "srt",
      mime: "application/x-subrip",
      use: "Subtitle editors and video players",
      description:
        "Numbered subtitle cues. Requires YouTube’s supplied cue end times; unavailable for modern panels that supply starts only. Overlapping ends are clipped at the next start.",
      example: "1\n00:01:30,000 --> 00:01:34,000\nThe next topic.",
    },
    {
      id: "vtt",
      label: "WebVTT subtitles",
      extension: "vtt",
      mime: "text/vtt",
      use: "Web video captions and browser players",
      description:
        "Web-standard timed cues. Requires YouTube’s supplied cue end times; unavailable for modern panels that supply starts only. Overlapping ends are clipped at the next start.",
      example: "WEBVTT\n\n00:01:30.000 --> 00:01:34.000\nThe next topic.",
    },
    {
      id: "json",
      label: "JSON with timed segments",
      extension: "json",
      mime: "application/json",
      use: "Scripts, indexing, and structured processing",
      description:
        "Video metadata and segments with start/end seconds and text. Supplied ends are preserved. Modern panels supply starts only, so end is null. This is transcript data, separate from bookmark backups.",
      example: '{ "start": 90, "end": 94, "text": "The next topic." }',
    },
  ];
  const get = (id) => formats.find((format) => format.id === id) || formats[0];
  const escapeMarkdown = (text) => String(text).replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");
  function timestamp(seconds) {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600),
      m = Math.floor(total / 60) % 60,
      s = total % 60;
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }
  function cueTime(positionSeconds, separator) {
    const totalMilliseconds = Math.round(positionSeconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3600000);
    const minutes = Math.floor(totalMilliseconds / 60000) % 60;
    const seconds = Math.floor(totalMilliseconds / 1000) % 60;
    const milliseconds = totalMilliseconds % 1000;
    const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
    return `${clock}${separator}${String(milliseconds).padStart(3, "0")}`;
  }
  function prepare(video, result) {
    if (result?.complete !== true)
      throw new Error("Transcript completeness could not be established. Nothing was copied.");
    if (
      !/^[A-Za-z0-9_-]{11}$/.test(video.id) ||
      !Array.isArray(result?.segments) ||
      !result.segments.length
    ) {
      throw new Error(
        "Could not read the timed transcript. Open Show transcript on YouTube and try again.",
      );
    }
    const duration =
      Number.isFinite(result.duration) && result.duration > 0 ? result.duration : null;
    const startsOnly = result.source === "youtube-panel-response";
    const segments = [];
    for (const segment of result.segments) {
      if (
        !Number.isFinite(segment.start) ||
        segment.start < 0 ||
        typeof segment.text !== "string" ||
        !segment.text.trim() ||
        (duration !== null && segment.start >= duration) ||
        (segments.length && segment.start < segments.at(-1).start)
      ) {
        throw new Error(
          "The transcript has invalid or out-of-order timing. Please reload the YouTube page and try again.",
        );
      }
      // Multiple caption rows can share a displayed start time. Join them so
      // subtitle exports never manufacture zero-length or overlapping cues.
      if (segments.at(-1)?.start === segment.start)
        segments.at(-1).text += " " + segment.text.trim();
      else
        segments.push({
          start: segment.start,
          ...(segment.end !== undefined ? { end: segment.end } : {}),
          text: segment.text.trim(),
        });
      if (
        !(startsOnly && segment.end === null) &&
        segment.end !== undefined &&
        (!Number.isFinite(segment.end) ||
          segment.end <= segment.start ||
          (duration !== null && segment.end > duration))
      ) {
        throw new Error(
          "The transcript has invalid cue end times. Please reload the YouTube page and try again.",
        );
      }
      if (segment.end !== undefined && segment.end !== null)
        segments.at(-1).end = Math.max(segments.at(-1).end ?? 0, segment.end);
    }
    segments.forEach((segment, index) => {
      const next = segments[index + 1]?.start;
      segment.end = startsOnly
        ? null
        : segment.end !== undefined
          ? Math.min(segment.end, next ?? segment.end)
          : (next ?? duration);
    });
    return {
      version: 1,
      video: {
        id: video.id,
        title: video.title || video.id,
        channelName: video.channelName || "",
        url: `https://www.youtube.com/watch?v=${video.id}`,
        duration,
      },
      timing: startsOnly
        ? "YouTube modern transcript paragraph start times; cue end times are not supplied and remain null."
        : "YouTube transcript cue timing; supplied cue ends are retained and clipped at the next start. Missing ends derive from the next start or known duration.",
      segments,
    };
  }
  function output(transcript, formatId) {
    const format = get(formatId);
    const { video, segments } = transcript;
    let text;
    if (format.id === "json") text = JSON.stringify(transcript, null, 2);
    else if (format.id === "text") text = segments.map((segment) => segment.text).join("\n");
    else if (format.id === "srt" || format.id === "vtt") {
      if (
        segments.some(
          (segment) =>
            !Number.isFinite(segment.end) ||
            segment.end <= segment.start ||
            Math.round(segment.end * 1000) <= Math.round(segment.start * 1000),
        )
      ) {
        throw new Error(
          "Subtitle export needs valid cue end times or a known video duration. This transcript lacks cue end times; choose Markdown, plain text, or JSON.",
        );
      }
      const separator = format.id === "srt" ? "," : ".";
      const cues = segments.map(
        (segment, index) =>
          `${format.id === "srt" ? `${index + 1}\n` : ""}${cueTime(segment.start, separator)} --> ${cueTime(segment.end, separator)}\n${format.id === "vtt" ? segment.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : segment.text}`,
      );
      text = (format.id === "vtt" ? "WEBVTT\n\n" : "") + cues.join("\n\n");
    } else {
      const markdown = format.id !== "text-timed";
      const header = markdown
        ? `# ${escapeMarkdown(video.title)}\n\nSource: ${video.url}`
        : `${video.title}\nSource: ${video.url}`;
      text =
        header +
        "\n\n" +
        segments
          .map((segment) => {
            const time = timestamp(segment.start);
            if (format.id === "markdown-linked")
              return `[${time}](${video.url}&t=${segment.start}s) · ${escapeMarkdown(segment.text)}`;
            if (format.id === "markdown") return `**${time}** · ${escapeMarkdown(segment.text)}`;
            return `${time} · ${segment.text}`;
          })
          .join(markdown ? "\n\n" : "\n");
    }
    const slug =
      video.title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "") || "transcript";
    return {
      text: text + "\n",
      filename: `${slug}-${video.id}.${format.extension}`,
      mime: format.mime + ";charset=utf-8",
    };
  }
  return { formats, get, prepare, output };
})();
