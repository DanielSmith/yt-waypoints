// Self-contained: executeScript serializes this function into the YouTube page.
// Mounted/virtualized DOM rows are never evidence of a complete transcript.
globalThis.WAYPOINTS_READ_TRANSCRIPT = async function transcript(expectedId) {
  const PANEL_ID = "engagement-panel-searchable-transcript";
  const MODERN_PANEL_ID = "PAmodern_transcript_view";
  const MAX_BYTES = 16000000;
  const fail = (message) => {
    throw new Error(message);
  };
  const matches = () =>
    new URLSearchParams(location.search).get("v") === expectedId &&
    document.querySelector("ytd-watch-flexy:not([hidden])")?.getAttribute("video-id") ===
      expectedId;
  const asPageObject = (value) => {
    try {
      return value?.wrappedJSObject || value;
    } catch {
      return null;
    }
  };
  const page = asPageObject(globalThis);
  const readConfig = (key) => {
    try {
      return typeof page.ytcfg?.get === "function" ? page.ytcfg.get(key) : page.ytcfg?.data_?.[key];
    } catch {
      return null;
    }
  };
  const string = (value, limit) =>
    typeof value === "string" && value.length > 0 && value.length <= limit;

  // The selected language token contains the video ID and caption-track key.
  // Decode only the bounded top-level protobuf fields; never synthesize a token.
  const tokenIdentity = (token, modern = false, videoOnly = false) => {
    if (!string(token, 20000)) fail("The selected transcript request is unavailable.");
    let bytes;
    try {
      bytes = atob(decodeURIComponent(token).replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      fail("The selected transcript request is not recognized.");
    }
    let offset = 0;
    const varint = () => {
      let value = 0,
        multiplier = 1;
      for (let index = 0; index < 8 && offset < bytes.length; index++) {
        const byte = bytes.charCodeAt(offset++);
        value += (byte & 127) * multiplier;
        if (!Number.isSafeInteger(value)) break;
        if (!(byte & 128)) return value;
        multiplier *= 128;
      }
      fail("The selected transcript request is malformed.");
    };
    const fields = {};
    while (offset < bytes.length) {
      const tag = varint();
      const field = Math.floor(tag / 8),
        wire = tag % 8;
      if (!field) fail("The selected transcript request is malformed.");
      if (wire === 2) {
        const length = varint();
        if (length > bytes.length - offset) fail("The selected transcript request is truncated.");
        if (field === 1 || field === 2 || (modern && field === 149)) {
          if (Object.hasOwn(fields, field)) fail("The selected transcript request is ambiguous.");
          fields[field] = bytes.slice(offset, offset + length);
        }
        offset += length;
      } else if (wire === 0) varint();
      else if (wire === 1 || wire === 5) offset += wire === 1 ? 8 : 4;
      else fail("The selected transcript request is not supported.");
      if (offset > bytes.length) fail("The selected transcript request is truncated.");
    }
    if (modern) {
      // Modern panel params wrap a video-bound message in protobuf field 149.
      // Reuse the bounded decoder on that nested message; no token synthesis.
      if (!fields[149]) fail("The modern transcript request is not recognized.");
      const nested = tokenIdentity(btoa(fields[149]), false, true);
      return { videoId: nested.videoId, track: token };
    }
    if (fields[1] !== expectedId || (!videoOnly && !fields[2]))
      fail("The transcript belongs to a different video or unknown language.");
    return { videoId: fields[1], track: fields[2] };
  };

  // Walk bounded page/response data, not mounted caption DOM. Discovery in the
  // whole watch page prunes unrelated deep branches. Response validation stays
  // strict: exceeding its bounds must never yield a partial transcript.
  const findModels = (roots, key, pageDiscovery = false) => {
    const found = [],
      seen = new WeakSet();
    let count = 0;
    const visit = (value, depth) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      if (depth > 35) {
        if (pageDiscovery) return;
        fail("The transcript response structure exceeds supported limits.");
      }
      if (++count > 150000)
        fail(
          pageDiscovery
            ? "YouTube page request discovery exceeds supported limits."
            : "The transcript response structure exceeds supported limits.",
        );
      seen.add(value);
      if (Object.hasOwn(value, key)) found.push(value[key]);
      for (const child of Object.values(value)) visit(child, depth + 1);
    };
    for (const root of roots) visit(root, 0);
    return found;
  };

  const modernSelection = (panels) => {
    const visible = [];
    for (let index = 0; index < Math.min(panels.length, 20); index++) {
      const data = asPageObject(panels[index])?.data;
      const list = data?.content?.sectionListRenderer;
      if (list && findModels([list.contents], "transcriptSegmentViewModel").length)
        visible.push(data);
    }
    if (!visible.length) return null;
    if (visible.length !== 1) fail("The modern transcript selection is ambiguous.");
    const roots = [
      asPageObject(document.querySelector("ytd-watch-flexy:not([hidden])"))?.data,
      asPageObject(document.querySelector("ytd-app"))?.data,
    ];
    const commands = findModels(roots, "updateEngagementPanelContentCommand", true);
    const tokens = new Set();
    for (const command of commands) {
      if (command?.contentSourcePanelIdentifier?.tag !== MODERN_PANEL_ID) continue;
      const params = command.globalConfiguration?.params;
      // Stale SPA commands must not become the current video's request.
      try {
        tokenIdentity(params, true);
        tokens.add(params);
      } catch {
        /* Ignore stale/unsupported candidates. */
      }
    }
    if (tokens.size !== 1)
      fail(
        "Could not identify one current-video modern transcript request. Reload the YouTube tab and try again.",
      );
    const params = [...tokens][0];
    const data = visible[0];
    const chips =
      data.header?.engagementPanelTitleHeaderRenderer?.subheader?.chipBarViewModel?.chips;
    const selectionKey = JSON.stringify([data.identifier, chips]);
    if (selectionKey.length > 100000)
      fail("The modern transcript selection exceeds supported limits.");
    return {
      modern: true,
      params,
      identity: tokenIdentity(params, true),
      selectionKey,
      language: "YouTube panel (language not supplied)",
    };
  };

  const selectionFrom = (search) => {
    const items =
      search?.footer?.transcriptFooterRenderer?.languageMenu?.sortFilterSubMenuRenderer
        ?.subMenuItems;
    if (!Array.isArray(items) || !items.length || items.length > 200) return null;
    let selection = null;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item?.selected !== true) continue;
      if (selection || !string(item.title, 200))
        fail("The transcript language selection is ambiguous.");
      const params =
        item.serviceEndpoint?.getTranscriptEndpoint?.params ||
        item.navigationEndpoint?.getTranscriptEndpoint?.params ||
        item.continuation?.reloadContinuationData?.continuation;
      if (!params) return null;
      selection = { params, language: item.title, identity: tokenIdentity(params) };
    }
    return selection;
  };

  const selectedTranscript = () => {
    const panels = document.querySelectorAll('[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
    const modern = modernSelection(panels);
    if (modern) return modern;
    for (let index = 0; index < Math.min(panels.length, 20); index++) {
      const panel = panels[index];
      if (
        panel.getAttribute("target-id") !== PANEL_ID &&
        !panel.querySelector(
          "ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-segment-list-renderer, transcript-segment-view-model",
        )
      )
        continue;
      const roots = [
        panel,
        panel.querySelector("ytd-transcript-renderer"),
        panel.querySelector("ytd-transcript-search-panel-renderer"),
      ];
      for (const root of roots) {
        const data = asPageObject(root)?.data;
        if (!data || typeof data !== "object") continue;
        const candidates = [
          data,
          data.transcriptSearchPanelRenderer,
          data.content?.transcriptSearchPanelRenderer,
          data.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer,
          data.transcriptRenderer?.content?.transcriptSearchPanelRenderer,
        ];
        for (const candidate of candidates) {
          const selection = selectionFrom(candidate);
          if (selection) return selection;
        }
      }
    }
    return null;
  };

  const readResponse = async (response, signal) => {
    if (!response.ok)
      fail(`YouTube could not provide a complete transcript (HTTP ${response.status}).`);
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      fail("The complete transcript response is too large.");
    if (!response.body?.getReader) fail("A complete transcript response could not be read.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0,
      text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (signal.aborted) fail("The complete transcript request timed out.");
        if (!matches()) fail("The video changed. Please try again.");
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) fail("The complete transcript response is too large.");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        /* Cancellation is best effort. */
      }
      throw error;
    }
    try {
      return JSON.parse(text.replace(/^\)\]\}'\s*\n/, ""));
    } catch {
      fail("YouTube returned an incomplete or unrecognized transcript response.");
    }
  };

  const extractModern = (response, requested) => {
    if (!response || typeof response !== "object" || response.error)
      fail("The modern transcript response is not supported.");
    for (const key of [
      "appendContinuationItemsAction",
      "reloadContinuationItemsCommand",
      "continuationItems",
    ]) {
      if (findModels([response], key).length)
        fail("YouTube has not provided a complete terminal transcript. Nothing was copied.");
    }
    const lists = findModels([response], "sectionListRenderer").filter(
      (list) => findModels([list?.contents], "transcriptSegmentViewModel").length,
    );
    if (lists.length !== 1) fail("The modern transcript response is missing or ambiguous.");
    const list = lists[0];
    const allowed = [
      "contents",
      "trackingParams",
      "header",
      "hideBottomSeparator",
      "targetId",
      "floatingPillRenderers",
      "syncModelEntityKey",
      "selectedItemAlignmentPercentOffset",
      "webComponentHint",
      "headerStyle",
      "continuations",
      "isLoading",
      "isComplete",
    ];
    const terminal = (value) => {
      if (
        (value.isLoading !== undefined && value.isLoading !== false) ||
        (value.isComplete !== undefined && value.isComplete !== true) ||
        (value.continuations !== undefined &&
          (!Array.isArray(value.continuations) || value.continuations.length))
      ) {
        fail("YouTube has not provided a complete terminal transcript. Nothing was copied.");
      }
    };
    if (Object.keys(list).some((key) => !allowed.includes(key)))
      fail("The modern transcript contains unsupported content.");
    terminal(list);
    if (!Array.isArray(list.contents) || !list.contents.length || list.contents.length > 50000)
      fail("The modern transcript is empty or too large.");
    const mediaDuration = document.querySelector("video")?.duration;
    const duration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : null;
    const segments = [];
    let characters = 0;
    const readMarker = (row, chapter = false) => {
      if (!row || Object.keys(row).length !== 1 || !row.macroMarkersPanelItemViewModel)
        fail("The modern transcript contains unknown or continued rows.");
      const marker = row.macroMarkersPanelItemViewModel;
      const endpoint = marker.onTap?.innertubeCommand?.watchEndpoint;
      if (endpoint?.videoId !== expectedId)
        fail("The modern transcript belongs to a different video.");
      const item = marker.item;
      if (!item || Object.keys(item).length !== 1)
        fail("The modern transcript contains unsupported captions.");
      if (chapter && item.timelineChapterViewModel) return;
      const timeline = item.timelineItemViewModel;
      if (
        !timeline ||
        chapter ||
        Object.keys(timeline).some((key) => !["timestamp", "contentItems", "style"].includes(key))
      )
        fail("The modern transcript contains unsupported captions.");
      const start = endpoint.startTimeSeconds;
      if (
        !Number.isFinite(start) ||
        start < 0 ||
        start > Math.floor(Number.MAX_SAFE_INTEGER / 1000) ||
        (duration !== null && start >= duration) ||
        (segments.length && start < segments.at(-1).start)
      )
        fail("The modern transcript has invalid cue timing.");
      if (
        !Array.isArray(timeline.contentItems) ||
        !timeline.contentItems.length ||
        timeline.contentItems.length > 1000
      )
        fail("The modern transcript contains unreadable captions.");
      const parts = [];
      for (const content of timeline.contentItems) {
        if (
          !content ||
          Object.keys(content).length !== 1 ||
          !content.transcriptSegmentViewModel ||
          !string(content.transcriptSegmentViewModel.simpleText, 10000)
        )
          fail("The modern transcript contains unreadable captions.");
        parts.push(content.transcriptSegmentViewModel.simpleText);
      }
      const rawText = parts.join(" ");
      characters += rawText.length;
      const text = rawText.replace(/\s+/g, " ").trim();
      if (!text || rawText.length > 10000 || characters > 2000000 || segments.length >= 50000)
        fail("The modern transcript is empty or too large.");
      // The modern panel has paragraph start times only. A null end is honest;
      // neither the last timestamp nor the media duration proves a cue end.
      segments.push({ start, end: null, text });
    };
    for (const row of list.contents) {
      if (!row || Object.keys(row).length !== 1)
        fail("The modern transcript contains unknown or continued sections.");
      const section = row.itemSectionRenderer;
      if (
        !section ||
        Object.keys(section).some(
          (key) =>
            ![
              "contents",
              "trackingParams",
              "header",
              "sectionIdentifier",
              "continuations",
              "isLoading",
              "isComplete",
            ].includes(key),
        )
      )
        fail("The modern transcript contains unknown or continued sections.");
      terminal(section);
      if (section.header !== undefined) readMarker(section.header, true);
      if (
        !Array.isArray(section.contents) ||
        !section.contents.length ||
        section.contents.length > 50000
      )
        fail("The modern transcript contains empty or oversized sections.");
      for (const caption of section.contents) readMarker(caption);
    }
    if (!segments.length) fail("No complete spoken transcript is available.");
    return {
      id: expectedId,
      duration,
      segments,
      complete: true,
      source: "youtube-panel-response",
      language: requested.language,
    };
  };

  const extract = (response, requested) => {
    if (
      !response ||
      typeof response !== "object" ||
      Object.keys(response).some(
        (key) => !["responseContext", "actions", "trackingParams"].includes(key),
      ) ||
      !Array.isArray(response.actions) ||
      response.actions.length !== 1
    )
      fail("The complete transcript response is not supported.");
    let search = null;
    for (const action of response.actions) {
      if (
        !action ||
        Object.keys(action).some(
          (key) => !["clickTrackingParams", "updateEngagementPanelAction"].includes(key),
        )
      )
        fail("The transcript response contains extra actions.");
      const update = action?.updateEngagementPanelAction;
      if (update?.targetId !== PANEL_ID) continue;
      if (search) fail("The transcript response is ambiguous.");
      search = update.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer;
    }
    const selection = selectionFrom(search);
    if (
      !selection ||
      selection.identity.track !== requested.identity.track ||
      selection.language !== requested.language
    )
      fail("The transcript language changed. Please try again.");
    if (
      Object.keys(search).some(
        (key) => !["header", "body", "footer", "targetId", "trackingParams"].includes(key),
      ) ||
      !search.body ||
      Object.keys(search.body).some((key) => key !== "transcriptSegmentListRenderer")
    )
      fail("The transcript response contains unsupported content.");
    const list = search.body?.transcriptSegmentListRenderer;
    const allowed = [
      "initialSegments",
      "noResultLabel",
      "retryLabel",
      "touchCaptionsEnabled",
      "trackingParams",
      "targetId",
      "continuations",
      "isLoading",
      "isComplete",
    ];
    if (
      !list ||
      Object.keys(list).some((key) => !allowed.includes(key)) ||
      (list.isLoading !== undefined && list.isLoading !== false) ||
      (list.isComplete !== undefined && list.isComplete !== true) ||
      (list.continuations && (!Array.isArray(list.continuations) || list.continuations.length))
    ) {
      fail("YouTube has not provided a complete terminal transcript. Nothing was copied.");
    }
    const rows = list.initialSegments;
    if (!Array.isArray(rows) || !rows.length || rows.length > 50000)
      fail("The complete transcript is empty or too large.");
    const videoDuration = document.querySelector("video")?.duration;
    const duration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : null;
    const segments = [];
    let characters = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Object.keys(row).length !== 1)
        fail("The complete transcript contains unknown rows.");
      if (row.transcriptSectionHeaderRenderer) continue; // Chapter headings are not spoken captions.
      const cue = row.transcriptSegmentRenderer;
      if (!cue) fail("The complete transcript contains unknown or continued rows.");
      const milliseconds = (value) => {
        if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
        if (!Number.isSafeInteger(value) || value < 0)
          fail("The complete transcript has invalid cue timing.");
        return value;
      };
      const start = milliseconds(cue.startMs) / 1000;
      const suppliedEnd = milliseconds(cue.endMs) / 1000;
      const end = duration === null ? suppliedEnd : Math.min(suppliedEnd, duration);
      if (
        end <= start ||
        (duration !== null && start >= duration) ||
        (segments.length && start < segments[segments.length - 1].start)
      )
        fail("The complete transcript has invalid cue timing.");
      if (cue.snippet?.simpleText !== undefined && cue.snippet?.runs !== undefined)
        fail("The complete transcript contains ambiguous captions.");
      let text = cue.snippet?.simpleText;
      if (text === undefined) {
        const runs = cue.snippet?.runs;
        if (!Array.isArray(runs) || !runs.length || runs.length > 1000)
          fail("The complete transcript contains unreadable captions.");
        text = "";
        for (const run of runs) {
          if (typeof run.text !== "string" || text.length + run.text.length > 10000)
            fail("The complete transcript contains oversized captions.");
          text += run.text;
        }
      }
      if (typeof text !== "string" || text.length > 10000)
        fail("The complete transcript contains invalid captions.");
      characters += text.length;
      if (characters > 2000000) fail("The complete transcript is too large.");
      text = text.replace(/\s+/g, " ").trim();
      if (!text) fail("The complete transcript contains empty captions.");
      segments.push({ start, end, text });
    }
    if (!segments.length) fail("No complete spoken transcript is available.");
    return {
      id: expectedId,
      duration,
      segments,
      complete: true,
      source: "youtube-transcript-response",
      language: requested.language,
    };
  };

  try {
    if (!/^[A-Za-z0-9_-]{11}$/.test(expectedId) || !matches())
      fail("The video changed. Please try again.");
    if (
      location.protocol !== "https:" ||
      !["www.youtube.com", "m.youtube.com", "youtube.com"].includes(location.hostname)
    )
      fail("Open this video on YouTube first.");
    let selection = selectedTranscript();
    if (!selection) {
      const button =
        document.querySelector("ytd-video-description-transcript-section-renderer button") ||
        [...document.querySelectorAll("button")].find(
          (candidate) =>
            (candidate.getAttribute("aria-label") || candidate.textContent || "")
              .trim()
              .toLowerCase() === "show transcript",
        );
      if (button) button.click();
      else if (
        !document.querySelectorAll('[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]').length
      )
        fail("No transcript found. Open Show transcript on YouTube and try again.");
      for (let attempt = 0; attempt < 40 && !selection; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!matches()) fail("The video changed. Please try again.");
        selection = selectedTranscript();
      }
    }
    if (!selection)
      fail(
        "Could not establish a complete transcript in this YouTube layout. Open Show transcript and try again; nothing was copied.",
      );
    const originalContext = readConfig("INNERTUBE_CONTEXT");
    const originalClient = originalContext?.client;
    if (!string(originalClient?.clientName, 50) || !string(originalClient?.clientVersion, 100))
      fail("YouTube transcript request details are unavailable. Reload the tab and try again.");
    const client = {
      clientName: originalClient.clientName,
      clientVersion: originalClient.clientVersion,
    };
    for (const key of ["hl", "gl", "visitorData"]) {
      if (originalClient[key] !== undefined) {
        if (!string(originalClient[key], 8192))
          fail("YouTube transcript request details are invalid.");
        client[key] = originalClient[key];
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // Fixed same-origin endpoint, using the selected page token/context. No
      // third-party service, API key, arbitrary URL, or caption-language guess.
      const endpoint = selection.modern
        ? "/youtubei/v1/get_panel?prettyPrint=false"
        : "/youtubei/v1/get_transcript?prettyPrint=false";
      let context = { client };
      if (selection.modern) {
        const serialized = JSON.stringify(originalContext);
        if (!string(serialized, 100000))
          fail("YouTube transcript request details exceed supported limits.");
        context = JSON.parse(serialized);
      }
      const body = { context, params: selection.params };
      if (selection.modern) body.panelId = MODERN_PANEL_ID;
      const response = await fetch(new URL(endpoint, location.href).href, {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readResponse(response, controller.signal);
      if (!matches()) fail("The video changed. Please try again.");
      const current = selectedTranscript();
      if (
        !current ||
        current.identity.track !== selection.identity.track ||
        current.language !== selection.language ||
        current.selectionKey !== selection.selectionKey
      )
        fail("The transcript language changed, or its panel changed. Please try again.");
      return selection.modern ? extractModern(data, selection) : extract(data, selection);
    } catch (error) {
      if (!matches()) fail("The video changed. Please try again.");
      if (controller.signal.aborted)
        fail("The complete transcript request timed out. Nothing was copied.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message =
      typeof error?.message === "string"
        ? error.message.slice(0, 450)
        : "Could not establish a complete transcript. Nothing was copied.";
    return { error: message || "Could not establish a complete transcript. Nothing was copied." };
  }
};
