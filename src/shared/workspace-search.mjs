// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import {
  normalizeVideoTags,
  suggestTagSlug,
  validateAlapName,
  renameMacro,
  normalizeMacroLibrary,
  inspectExpandedAlapExpression,
  ALAP_LIMITS,
} from "./alap-data.mjs";
import { createMacroExpander } from "./alap-macro-expansion.mjs";
import { fetchCreatorTags, creatorTagOptions } from "./creator-tags.mjs";
import { createMacroStore } from "./alap-macro-store.mjs";
import { searchVideos } from "./alap-query.mjs";
import { createPopupRefresh } from "./popup-refresh.mjs";

export async function initializeSearchWorkspace() {
  const api = globalThis.browser ?? globalThis.chrome;
  const storage = globalThis.WAYPOINTS_STORAGE;
  const macroStore = createMacroStore(api);
  const $ = (id) => document.getElementById("workspace-" + id);
  const order = (a, b) => (b.updated || 0) - (a.updated || 0) || a.id.localeCompare(b.id);
  const tagStatus = (text) => {
    $("tag-status").textContent = text;
  };
  const macroStatus = (text) => {
    $("macro-status").textContent = text;
  };
  const textNode = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  };
  const titleOf = (video) => video.title || video.id;
  const caption = (video) => [titleOf(video), video.channelName].filter(Boolean).join(" · ");
  const sameTags = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let videos = Object.create(null),
    records = {},
    includeChannelNames = true;
  let catalog = [];
  let registry, tagDraft, macroDraft;
  let tagBusy = false,
    macroBusy = false,
    previewTimer;
  let rowLimit = 50;

  const tagsDirty = () =>
    tagDraft &&
    (!sameTags(tagDraft.base.tags, tagDraft.tags) || Boolean($("tag-input").value.trim()));
  const macroDirty = () =>
    macroDraft &&
    ($("macro-name").value !== macroDraft.name ||
      $("macro-expression").value !== macroDraft.expression);

  const refresh = createPopupRefresh({
    async read() {
      const [snapshot, macroState] = await Promise.all([
        storage.read(),
        macroStore.read().then(
          (value) => ({ value }),
          (error) => ({ error: error.message }),
        ),
      ]);
      return { snapshot, macroState };
    },
    commit({ snapshot, macroState }) {
      videos = snapshot.videos;
      records = snapshot.records;
      catalog = Object.values(videos).sort(order);
      includeChannelNames = snapshot.settings.includeChannelNames !== false;
      registry = macroState.value;
      if (macroState.error) macroStatus(macroState.error);
      renderVideos();
      renderTags();
      renderMacroChoices();
      renderMacroConflicts();
    },
  });
  const refreshWorkspace = () => refresh.refresh().catch((error) => tagStatus(error.message));

  function renderVideos() {
    const focusId = document.activeElement?.closest("#workspace-videos button")?.dataset.id;
    // This field searches literal titles, channels and tags; Alap has its own preview.
    const { ids } = searchVideos(catalog, $("filter").value, {
      literal: true,
      includeChannelNames,
    });
    $("count").textContent = ids.length ? `${ids.length} matching videos` : "No matching videos.";
    $("videos").replaceChildren(
      ...ids.slice(0, rowLimit).map((id) => {
        const row = textNode("li", "");
        const button = textNode("button", caption(videos[id]));
        button.className = "secondary-button";
        button.type = "button";
        button.dataset.id = id;
        button.setAttribute("aria-pressed", String(id === tagDraft?.base.id));
        button.addEventListener("click", () => openTags(id));
        row.append(button);
        return row;
      }),
    );
    $("more").hidden = ids.length <= rowLimit;
    if (focusId) {
      const button = [...$("videos").querySelectorAll("button")].find(
        (item) => item.dataset.id === focusId,
      );
      (button || $("filter")).focus({ preventScroll: true });
    }
  }

  function tagConflict() {
    if (!tagDraft) return false;
    const { id, lifetime } = tagDraft.base;
    return !videos[id] || JSON.stringify(records[id]?.life.v) !== JSON.stringify(lifetime);
  }

  function updateTagControls() {
    $("tags-save").disabled = tagBusy || tagConflict() || !tagsDirty();
    $("tags-cancel").disabled = tagBusy;
    $("creator-read").disabled = !tagDraft || tagBusy || tagConflict() || tagDraft.reading;
    $("creator-add").disabled = !tagDraft || tagBusy || tagConflict();
    if (tagConflict())
      tagStatus(
        "This bookmark changed or was removed. Your draft is kept. Cancel and reopen the bookmark to edit its current tags.",
      );
  }

  function renderCreatorOptions() {
    if (!tagDraft) return;
    const choices = creatorTagOptions(tagDraft.keywords, tagDraft.tags, tagDraft.removedTags);
    const list = $("creator-list");
    const selected = new Set(
      [...list.querySelectorAll("input:checked")].map((input) => input.value),
    );
    list.replaceChildren(
      ...choices.map(({ original, tag, reason }) => {
        const row = textNode("li", "");
        const label = textNode("label", "");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = tag || "";
        box.disabled = Boolean(reason);
        box.checked = !reason && selected.has(tag);
        const text = textNode("span", original);
        if (tag || reason)
          text.append(textNode("small", [tag, reason].filter(Boolean).join(" · ")));
        label.append(box, text);
        row.append(label);
        return row;
      }),
    );
    const hasAvailable = choices.some((choice) => !choice.reason);
    $("creator-add").hidden = !hasAvailable;
    $("creator-add").disabled = tagConflict() || tagBusy;
    return hasAvailable;
  }

  async function readCreatorSuggestions() {
    const draft = tagDraft;
    if (!draft || draft.reading || tagBusy || tagConflict()) return;
    draft.reading = true;
    $("creator-read").disabled = true;
    $("creator-status").textContent = "Reading creator tags…";
    draft.keywords = [];
    renderCreatorOptions();
    try {
      const keywords = await fetchCreatorTags(api, draft.base.id);
      if (tagDraft !== draft || tagConflict()) return;
      draft.keywords = keywords;
      $("creator-list").replaceChildren();
      const hasAvailable = renderCreatorOptions();
      $("creator-status").textContent = !keywords.length
        ? "YouTube supplied no creator tags for this video."
        : hasAvailable
          ? "Select tags to add. Save tags to apply them to the bookmark."
          : "None of these creator tags can be added to the current draft.";
    } catch (error) {
      if (tagDraft === draft && !tagConflict()) $("creator-status").textContent = error.message;
    } finally {
      draft.reading = false;
      if (tagDraft === draft) {
        if (tagConflict())
          $("creator-status").textContent = "Reopen the bookmark to read creator tags.";
        updateTagControls();
      }
    }
  }

  function renderTags() {
    $("tags").hidden = !tagDraft;
    $("creator-tags").hidden = !tagDraft;
    if (!tagDraft) return;
    const id = tagDraft.base.id;
    $("video-title").textContent = videos[id] ? titleOf(videos[id]) : tagDraft.title;
    const focusTag = document.activeElement?.closest("#workspace-tag-list button")?.dataset.tag;
    $("tag-list").replaceChildren(
      ...tagDraft.tags.map((tag) => {
        const row = textNode("li", "");
        const button = textNode("button", tag + " ×");
        button.className = "secondary-button";
        button.type = "button";
        button.dataset.tag = tag;
        button.setAttribute("aria-label", "Remove tag " + tag);
        button.addEventListener("click", () => {
          tagDraft.tags = tagDraft.tags.filter((item) => item !== tag);
          tagDraft.removedTags.add(tag);
          renderCreatorOptions();
          $("tag-input").focus();
          renderTags();
        });
        row.append(button);
        return row;
      }),
    );
    if (focusTag) {
      const button = [...$("tag-list").querySelectorAll("button")].find(
        (item) => item.dataset.tag === focusTag,
      );
      (button || $("tag-input")).focus({ preventScroll: true });
    }
    const tags = new Set(catalog.flatMap((video) => video.tags ?? []));
    $("tag-suggestions").replaceChildren(
      ...[...tags].sort().map((tag) => {
        const option = document.createElement("option");
        option.value = tag;
        return option;
      }),
    );
    updateTagControls();
  }

  async function openTags(id) {
    if (tagBusy || tagDraft?.base.id === id) return;
    if (tagsDirty())
      return tagStatus("Save or cancel the current tag draft before choosing another video.");
    tagBusy = true;
    try {
      const base = await storage.readTagDraft(id);
      tagDraft = {
        base,
        tags: [...base.tags],
        title: videos[id]?.title || id,
        keywords: [],
        removedTags: new Set(),
        reading: false,
      };
      $("creator-status").textContent = "";
      $("creator-list").replaceChildren();
      renderCreatorOptions();
      $("tag-input").value = "";
      $("slug").textContent = "";
      tagStatus("");
      renderTags();
      renderVideos();
      $("tag-input").focus();
    } catch (error) {
      tagStatus(error.message);
    } finally {
      tagBusy = false;
      updateTagControls();
    }
  }

  function renderMacroChoices() {
    const choices = Object.keys(registry?.library.macros ?? {});
    $("macros").replaceChildren(textNode("option", "Choose a macro"));
    $("macros").firstChild.value = "";
    for (const name of choices) {
      const option = textNode("option", "@" + name);
      option.value = name;
      $("macros").append(option);
    }
    $("macros").value = macroDraft?.name ?? "";
    $("macros").disabled = !registry;
    $("macro-new").disabled = !registry;
  }

  function renderMacroConflicts() {
    if (!macroDraft) return;
    const stale = registry?.revision !== macroDraft.revision;
    $("macro-save").disabled = stale || macroBusy;
    $("macro-delete").disabled = stale || macroBusy || !macroDraft.name || Boolean(macroDirty());
    if (stale)
      macroStatus(
        "Saved macros changed elsewhere. Your draft is kept. Copy any changes you want to keep, then cancel and reopen to edit the latest version.",
      );
  }

  function openMacro(name) {
    if (macroBusy || !registry) return;
    if (macroDraft && macroDraft.name === name) return;
    if (macroDirty()) {
      $("macros").value = macroDraft.name;
      return macroStatus("Save or cancel the current macro draft before opening another.");
    }
    const expression = registry.library.macros[name]?.linkItems ?? "";
    macroDraft = { name, expression, revision: registry.revision, library: registry.library };
    $("macro-form").hidden = false;
    $("macro-name").value = name;
    $("macro-expression").value = expression;
    $("preview-selection").value = "";
    macroStatus("");
    renderMacroChoices();
    renderMacroConflicts();
    renderPreview();
    $(name ? "macro-expression" : "macro-name").focus();
  }

  function draftLibrary() {
    const name = validateAlapName($("macro-name").value.trim());
    const expression = $("macro-expression").value.trim();
    const { library, name: original } = macroDraft;
    if (!original && Object.hasOwn(library.macros, name))
      throw new Error(`A macro named @${name} already exists.`);
    const base = original && name !== original ? renameMacro(library, original, name) : library;
    return {
      name,
      library: normalizeMacroLibrary({
        version: base.version,
        macros: { ...base.macros, [name]: { linkItems: expression } },
      }),
    };
  }

  function renderPreview() {
    $("preview-rows").replaceChildren();
    if (!macroDraft || (!$("macro-name").value && !$("macro-expression").value)) {
      $("preview-source").hidden = true;
      $("preview-count").textContent = macroDraft ? "Enter a name and expression to preview." : "";
      return;
    }
    let needsSelection = false;
    try {
      const { name, library } = draftLibrary();
      const expander = createMacroExpander(library.macros, ALAP_LIMITS);
      const { kind } = inspectExpandedAlapExpression(expander.expandMacro(name), {
        modifier: true,
      });
      needsSelection = kind === "modifier";
      $("preview-source").hidden = !needsSelection;
      const selection = needsSelection ? $("preview-selection").value.trim() : "";
      if (needsSelection && !selection) {
        $("preview-count").textContent = "Enter a tag or saved search above to see a preview.";
        return;
      }
      const expression = selection ? `(${selection}) @${name}` : `@${name}`;
      const result = searchVideos(catalog, expression, { macros: library.macros });
      const outcome =
        result.rootInputCount === null
          ? `${result.resultCount} matches`
          : `${result.resultCount} of ${result.rootInputCount} matches`;
      $("preview-count").textContent =
        outcome + (result.resultCount > 20 ? " (first 20 shown)" : "");
      $("preview-rows").replaceChildren(
        ...result.ids.slice(0, 20).map((id) => textNode("li", caption(videos[id]))),
      );
    } catch (error) {
      $("preview-source").hidden = !needsSelection;
      $("preview-count").textContent =
        `Preview: ${error.message.replace(/^Invalid Alap data: /, "")}`;
    }
  }

  function closeMacro() {
    clearTimeout(previewTimer);
    macroDraft = undefined;
    $("macro-form").hidden = true;
    renderMacroChoices();
    $("macros").focus();
  }

  async function commitMacro(remove = false) {
    if (!macroDraft || macroBusy || (remove && macroDirty())) return;
    macroBusy = true;
    $("macro-form").inert = true;
    try {
      const revision = macroDraft.revision;
      if (remove) {
        await macroStore.remove(revision, macroDraft.name);
        closeMacro();
        macroStatus("Macro deleted.");
      } else {
        const { name, library } = draftLibrary();
        const saved = await macroStore.replace(revision, library);
        registry = saved;
        macroDraft = undefined;
        openSavedMacroAfterWrite(name, saved);
        macroStatus(`Saved @${name}.`);
      }
      await refreshWorkspace();
    } catch (error) {
      macroStatus(error.message);
    } finally {
      macroBusy = false;
      $("macro-form").inert = false;
      renderMacroConflicts();
      if (macroDraft) $("macro-expression").focus();
    }
  }

  function openSavedMacroAfterWrite(name, saved) {
    macroDraft = {
      name,
      expression: saved.library.macros[name].linkItems,
      revision: saved.revision,
      library: saved.library,
    };
    $("macro-name").value = name;
    $("macro-expression").value = macroDraft.expression;
    renderMacroChoices();
    renderPreview();
  }

  $("filter").maxLength = 4096;
  $("filter").addEventListener("input", () => {
    rowLimit = 50;
    renderVideos();
  });
  $("more").addEventListener("click", () => {
    rowLimit += 50;
    renderVideos();
  });
  $("tag-input").addEventListener("input", () => {
    try {
      const raw = $("tag-input").value;
      $("slug").textContent = raw.trim() ? `Will add: ${suggestTagSlug(raw)}` : "";
    } catch (error) {
      $("slug").textContent = error.message;
    }
    updateTagControls();
  });
  $("tags").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!tagDraft || tagBusy) return;
    try {
      const tag = suggestTagSlug($("tag-input").value);
      tagDraft.tags = normalizeVideoTags([...new Set([...tagDraft.tags, tag])]);
      tagDraft.removedTags.delete(tag);
      renderCreatorOptions();
      $("tag-input").value = "";
      $("slug").textContent = "";
      renderTags();
      $("tag-input").focus();
    } catch (error) {
      tagStatus(error.message);
    }
  });
  $("creator-read").addEventListener("click", readCreatorSuggestions);
  $("creator-add").addEventListener("click", () => {
    if (!tagDraft || tagBusy || tagConflict()) return;
    const allowed = new Set(
      creatorTagOptions(tagDraft.keywords, tagDraft.tags, tagDraft.removedTags)
        .filter((choice) => !choice.reason)
        .map((choice) => choice.tag),
    );
    const checked = [...$("creator-list").querySelectorAll("input:checked")];
    const selected = checked.map((box) => box.value).filter((tag) => allowed.has(tag));
    if (!selected.length) {
      $("creator-status").textContent = "Select at least one creator tag.";
      return;
    }
    try {
      tagDraft.tags = normalizeVideoTags([...tagDraft.tags, ...selected]);
      renderTags();
      renderCreatorOptions();
      $("tag-input").focus();
      $("creator-status").textContent = "Tags added to the draft. Save tags to keep them.";
    } catch (error) {
      $("creator-status").textContent = error.message;
    }
  });
  $("tags-save").addEventListener("click", async () => {
    if (!tagDraft || tagBusy || tagConflict()) return;
    if ($("tag-input").value.trim())
      return tagStatus("Add the typed tag or clear the field before saving.");
    tagBusy = true;
    $("tags").inert = true;
    try {
      const saved = await storage.saveTagDraft(tagDraft.base, tagDraft.tags);
      tagDraft.base = { ...tagDraft.base, tags: saved };
      tagDraft.tags = [...saved];
      tagStatus("Tags saved.");
      await refreshWorkspace();
    } catch (error) {
      tagStatus(error.message);
    } finally {
      $("tags").inert = false;
      tagBusy = false;
      renderTags();
      $("tag-input").focus();
    }
  });
  $("tags-cancel").addEventListener("click", () => {
    tagDraft = undefined;
    renderTags();
    renderVideos();
    $("filter").focus();
    tagStatus("Tag edits cancelled.");
  });
  $("macro-new").addEventListener("click", () => openMacro(""));
  $("macros").addEventListener("change", () => {
    if ($("macros").value) openMacro($("macros").value);
    else $("macros").value = macroDraft?.name ?? "";
  });
  $("macro-cancel").addEventListener("click", () => {
    closeMacro();
    macroStatus("Macro edits cancelled.");
  });
  $("macro-delete").addEventListener("click", () => commitMacro(true));
  $("preview-refresh").addEventListener("click", () => {
    clearTimeout(previewTimer);
    renderPreview();
  });
  $("macro-form").addEventListener("submit", (event) => {
    event.preventDefault();
    commitMacro();
  });
  for (const id of ["macro-name", "macro-expression", "preview-selection"]) {
    $(id).addEventListener("input", () => {
      renderMacroConflicts();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 150);
    });
  }
  addEventListener("beforeunload", (event) => {
    if (tagsDirty() || macroDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (storage.changed(changes) || changes.settings)) refreshWorkspace();
  });
  macroStore.subscribe(refreshWorkspace);
  await refresh.refresh();
}
