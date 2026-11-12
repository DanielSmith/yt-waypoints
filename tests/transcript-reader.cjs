const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const flavor = process.argv[2] || 'firefox';
const extension = path.join(__dirname, '../yt-waypoints-' + flavor);
const read = name => fs.readFileSync(path.join(extension, name), 'utf8');
const action = vm.runInNewContext(read('transcript-reader.js') + '\n' + read('player.js') + '\nWAYPOINTS_PLAYER_ACTIONS.transcript', { WAYPOINTS_READ_METADATA: () => {} });
const schema = vm.runInNewContext(read('player-results.js') + '\nWAYPOINTS_PLAYER_RESULTS', { URL });
const formats = vm.runInNewContext(read('transcript.js') + '\nWAYPOINTS_TRANSCRIPT');
const ID = 'aaaaaaaaaaa';
const PANEL = 'engagement-panel-searchable-transcript';
function token(id = ID, track = 'English-track') {
  const a = Buffer.from(id), b = Buffer.from(track);
  return Buffer.concat([Buffer.from([10, a.length]), a, Buffer.from([18, b.length]), b]).toString('base64');
}
function modernToken(id = ID, extra = false) {
  const nested = Buffer.concat([Buffer.from([10, 11]), Buffer.from(id), Buffer.from([24, 2])]);
  return Buffer.concat([Buffer.from([170, 9, nested.length]), nested, Buffer.from(extra ? [24, 0] : [])]).toString('base64url');
}
function modernRow(start, text, id = ID) {
  return { macroMarkersPanelItemViewModel: {
    item: { timelineItemViewModel: { timestamp: '0:03', style: 'TIMELINE_STYLE', contentItems: [
      { transcriptSegmentViewModel: { simpleText: text, style: 'TRANSCRIPT_STYLE', timestamp: '0:03',
        timestampUtf16Length: 4, textUtf16Length: text.length, accessibilityHint: 'Seek',
        lightThemeColorPalette: { additiveBackground: 1, textSecondary: 2 },
        darkThemeColorPalette: { additiveBackground: 3, textSecondary: 4 }, timestampA11yLabel: '3 seconds' } },
    ] } }, index: start, markersEngagementPanelSyncEntityKey: 'fixture-sync', panelId: 'fixture-panel',
    onTap: { innertubeCommand: { clickTrackingParams: 'fixture', commandMetadata: { webCommandMetadata: {} },
      watchEndpoint: { videoId: id, startTimeSeconds: start, continuePlayback: true, playerParams: 'fixture' } } },
  } };
}
function modernList(rows = [modernRow(3, 'First modern caption'), modernRow(1419, 'Last modern caption')]) {
  const chapter = modernRow(0, 'Chapter');
  chapter.macroMarkersPanelItemViewModel.item = { timelineChapterViewModel: { title: 'Chapter', style: 'CHAPTER_STYLE', index: 0 } };
  return { contents: [{ itemSectionRenderer: { contents: rows, header: chapter, sectionIdentifier: 'chapter-0', trackingParams: 'fixture' } }],
    trackingParams: 'fixture', header: { searchInputViewModel: {
      onInputAction: { command: { innertubeCommand: { continuationCommand: { token: 'filtered-search-token', request: 'fixture' } } } },
    } }, targetId: 'fixture-panel', hideBottomSeparator: true,
    floatingPillRenderers: {}, syncModelEntityKey: 'fixture-sync', selectedItemAlignmentPercentOffset: .5,
    webComponentHint: { componentVersion: 'fixture' }, headerStyle: 'fixture' };
}
function modernResponse(list = modernList()) {
  // The parser must locate the unique terminal list through response wrappers,
  // while validating every section/row rather than recursively harvesting text.
  return { responseContext: {}, actions: [{ updateEngagementPanelAction: { content: { sectionListRenderer: list } } }] };
}
function menu(params = token(), language = 'English', selected = true) {
  return { transcriptFooterRenderer: { languageMenu: { sortFilterSubMenuRenderer: {
    subMenuItems: [{ title: language, selected, continuation: { reloadContinuationData: { continuation: params } } }],
  } } } };
}
function cue(startMs, endMs, text) {
  return { transcriptSegmentRenderer: { startMs: String(startMs), endMs: String(endMs), snippet: { runs: [{ text }] } } };
}
const rows = () => [cue(0, 2000, 'First line'), { transcriptSectionHeaderRenderer: { snippet: { simpleText: 'Chapter heading' } } }, cue(90000, 95000, 'Second line')];
function responseFor({ params = token(), language = 'English', list = { initialSegments: rows() } } = {}) {
  return { responseContext: {}, actions: [{ updateEngagementPanelAction: { targetId: PANEL,
    content: { transcriptRenderer: { content: { transcriptSearchPanelRenderer: { footer: menu(params, language), body: { transcriptSegmentListRenderer: list } } } } },
  } }] };
}
function fixture(options = {}) {
  let unrelatedPageData = { value: 'Unrelated deeply nested YouTube metadata' };
  for (let depth = 0; depth < 50; depth++) unrelatedPageData = { child: unrelatedPageData };
  const state = { visible: !options.closed, polls: 0, clicks: 0, requests: [], timerCleared: false,
    available: !options.loadAfter, params: options.modern ? modernToken(options.tokenId || ID) : token(options.tokenId || ID, options.track || 'English-track'), language: 'English', cancelled: false };
  const location = { search: '?v=' + ID, href: 'https://www.youtube.com/watch?v=' + ID, protocol: 'https:', hostname: options.host || 'www.youtube.com' };
  const row = { querySelector: selector => ({ textContent: selector.includes('Timestamp') ? '0:00' : 'Only one mounted caption' }) };
  const renderer = {};
  Object.defineProperty(options.wrapped ? (renderer.wrappedJSObject = {}) : renderer, 'data', { get() {
    if (options.partialOnly || !state.available) return undefined;
    return { content: { transcriptSearchPanelRenderer: { footer: options.menu || menu(state.params, state.language), body: { transcriptSegmentListRenderer: { initialSegments: [cue(0, 2000, 'Partial cached model')] } } } } };
  } });
  const panel = {
    getAttribute: name => name === 'target-id' ? PANEL : null,
    querySelector: selector => selector.includes('ytd-transcript') ? renderer : row,
    querySelectorAll: () => [row],
  };
  if (options.modern) {
    Object.defineProperty(panel, 'data', { get() {
      return state.available ? { identifier: { surface: 'fixture', tag: 'visible-modern-panel' },
        header: { engagementPanelTitleHeaderRenderer: { subheader: { chipBarViewModel: {
          chips: [{ chipViewModel: { text: state.language, selected: true } }],
        } } } }, content: { sectionListRenderer: modernList([modernRow(3, 'Only a cached mounted caption')]) }, footer: null } : undefined;
    } });
    panel.getAttribute = () => null; // Actual failing layout has no target-id.
    panel.querySelector = () => null; // It has none of the legacy renderers.
  }
  const document = {
    querySelector(selector) {
      if (selector === 'video') return { duration: options.duration === undefined ? 3600 : options.duration };
      if (selector.startsWith('ytd-watch-flexy')) return { getAttribute: () => location.search.slice(3),
        data: options.modern ? { updateEngagementPanelContentCommand: {
          contentSourcePanelIdentifier: { tag: 'PAmodern_transcript_view' }, globalConfiguration: { params: state.params },
        }, ...(options.deepPage ? { unrelated: unrelatedPageData } : {}), ...(options.ambiguousModern ? { other: { updateEngagementPanelContentCommand: {
          contentSourcePanelIdentifier: { tag: 'PAmodern_transcript_view' }, globalConfiguration: { params: modernToken(ID, true) },
        } } } : {}) } : undefined };
      if (selector.includes('transcript-section') && !options.missing) return { click() { state.clicks++; state.visible = true; } };
      return null;
    },
    querySelectorAll: selector => selector === 'button' ? [] : state.visible ? [panel] : [],
  };
  const ytcfg = { get: () => options.noContext ? null : { client: { clientName: 'WEB', clientVersion: '2.fixture', hl: 'en', gl: 'US', visitorData: 'test-visitor' } } };
  const globals = { document, location, URL, URLSearchParams, AbortController, TextDecoder, atob, btoa,
    ytcfg, ...(options.wrapped ? { wrappedJSObject: { ytcfg } } : {}),
    setTimeout(fn, milliseconds) {
      if (milliseconds === 200) {
        state.polls++;
        if (state.polls >= (options.loadAfter || 0)) state.available = true;
        if (options.navigateDuringPoll) location.search = '?v=bbbbbbbbbbb';
        fn();
      } else {
        assert.equal(milliseconds, 8000);
        if (options.timeout) queueMicrotask(fn);
      }
      return 1;
    },
    clearTimeout() { state.timerCleared = true; },
    async fetch(url, request) {
      state.requests.push({ url, request });
      assert.equal(url, options.modern ? 'https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false' : 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false');
      assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
      const body = JSON.parse(request.body);
      assert.equal(body.params, state.params, 'use the selected language token, never a search/default-language guess');
      assert.equal(body.context.client.clientVersion, '2.fixture');
      if (options.modern) assert.equal(body.panelId, 'PAmodern_transcript_view');
      if (options.timeout) return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('Aborted'))));
      if (options.networkError) throw Error('Network failed');
      if (options.navigateDuringFetch) location.search = '?v=bbbbbbbbbbb';
      if (options.languageDuringFetch) { state.params = token(ID, 'French-track'); state.language = 'French'; }
      if (options.panelDuringFetch) state.language = 'French';
      if (options.oversizedStream) return { ok: true, headers: new Headers(), body: { getReader: () => ({
        read: async () => ({ done: false, value: { byteLength: 16000001 } }),
        cancel: async () => { state.cancelled = true; },
      }) } };
      const value = options.response || (options.modern ? modernResponse() : responseFor());
      if (options.deepResponse) value.unrelated = unrelatedPageData;
      return new Response(options.badEncoding ? new Uint8Array([123,34,116,34,58,34,255,34,125]) : options.truncated ? '{"actions":[' : JSON.stringify(value), {
        status: options.status || 200, headers: { 'content-type': 'application/json', ...(options.oversizedHeader ? { 'content-length': '16000001' } : {}) },
      });
    },
  };
  return { state, async run() {
    return vm.runInNewContext('(' + action.toString() + ')(expectedId)', { ...globals, expectedId: ID });
  } };
}
async function main() {
  // This failed on the original reader: it immediately returned one mounted row.
  const partial = fixture({ partialOnly: true });
  assert.match((await partial.run()).error, /complete transcript/);
  assert.equal(partial.state.requests.length, 0);
  assert.equal(partial.state.polls, 40);
  console.log('PASS: stable nonempty mounted rows alone are rejected, not exported');

  for (const options of [{}, { wrapped: true }, { closed: true, loadAfter: 3 }]) {
    const source = fixture(options);
    const result = await source.run();
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.complete, true); assert.equal(result.source, 'youtube-transcript-response');
    assert.equal(result.language, 'English'); assert.equal(result.segments.length, 2);
    assert.equal(result.segments[1].text, 'Second line'); assert.equal(result.segments[1].end, 95);
    assert.equal(source.state.requests.length, 1);
    assert.equal(source.state.timerCleared, true);
    if (options.closed) { assert.equal(source.state.clicks, 1); assert.equal(source.state.polls, 3); }
    const clean = schema.validate('transcript', result, ID);
    const prepared = formats.prepare({ id: ID, title: 'Complete transcript' }, clean);
    const srt = formats.output(prepared, 'srt');
    assert.ok(srt.text.includes('00:01:30,000 --> 00:01:35,000'), 'use the supplied final cue end, never stretch it to one hour');
    for (const format of ['markdown-linked', 'markdown', 'text-timed', 'text', 'srt', 'vtt', 'json']) assert.ok(formats.output(prepared, format).text.includes('Second line'));
  }
  console.log('PASS: full selected-language responses defeat incremental/virtualized/cached partial rows; all formats retain full content and actual cue ends');

  const base = { initialSegments: rows() };
  const failures = [
    [{ closed: true, missing: true }, /No transcript/],
    [{ closed: true, loadAfter: 100 }, /complete transcript/],
    [{ navigateDuringPoll: true, loadAfter: 3 }, /video changed/],
    [{ navigateDuringFetch: true }, /video changed/],
    [{ languageDuringFetch: true }, /language changed/],
    [{ tokenId: 'bbbbbbbbbbb' }, /different video/],
    [{ noContext: true }, /request details/],
    [{ menu: menu(token(), 'English', false) }, /complete transcript/],
    [{ menu: menu('not-base64!') }, /not recognized/],
    [{ host: 'evil.example' }, /YouTube first/],
    [{ networkError: true }, /Network failed/],
    [{ status: 403 }, /HTTP 403/],
    [{ truncated: true }, /incomplete or unrecognized/],
    [{ badEncoding: true }, /encoding|encoded/i],
    [{ timeout: true }, /timed out/],
    [{ oversizedHeader: true }, /too large/],
    [{ oversizedStream: true }, /too large/],
    [{ response: responseFor({ params: token(ID, 'French-track') }) }, /language changed/],
    [{ response: responseFor({ list: { ...base, continuations: [{ nextContinuationData: { continuation: 'more' } }] } }) }, /complete terminal/],
    [{ response: responseFor({ list: { ...base, isLoading: true } }) }, /complete terminal/],
    [{ response: responseFor({ list: { ...base, isComplete: false } }) }, /complete terminal/],
    [{ response: responseFor({ list: { ...base, isLoading: 'false' } }) }, /complete terminal/],
    [{ response: responseFor({ list: { ...base, nextPage: 'unknown' } }) }, /complete terminal/],
    [{ response: responseFor({ list: { initialSegments: [cue(0, 2000, 'First'), { continuationItemRenderer: {} }] } }) }, /unknown or continued/],
    [{ response: responseFor({ list: { initialSegments: [cue(0, 2000, 'First'), { newCaptionRenderer: {} }] } }) }, /unknown or continued/],
    [{ response: responseFor({ list: { initialSegments: [cue(10, 5, 'Backwards')] } }) }, /invalid cue/],
    [{ response: responseFor({ list: { initialSegments: [cue('bad', 2000, 'Bad timestamp')] } }) }, /invalid cue/],
    [{ response: responseFor({ list: { initialSegments: [cue(0, undefined, 'Missing end')] } }) }, /invalid cue/],
    [{ response: responseFor({ list: { initialSegments: [cue(90000, 95000, 'Later'), cue(0, 2000, 'Earlier')] } }) }, /invalid cue/],
    [{ response: responseFor({ list: { initialSegments: [cue(0, 2000, 'x'.repeat(10001))] } }) }, /oversized captions/],
    [{ response: { ...responseFor(), continuationContents: {} } }, /not supported/],
    [{ response: { ...responseFor(), actions: [{ ...responseFor().actions[0], appendContinuationItemsAction: {} }] } }, /extra actions/],
    [{ response: { ...responseFor(), actions: [...responseFor().actions, { appendContinuationItemsAction: {} }] } }, /not supported/],
  ];
  for (const [options, message] of failures) {
    const source = fixture(options);
    const result = await source.run();
    assert.match(result.error, message, JSON.stringify(options));
    assert.equal(result.segments, undefined, 'a failure must never return accumulated partial content');
    if (options.oversizedStream) assert.equal(source.state.cancelled, true);
  }
  const clip = await fixture({ duration: 100, response: responseFor({ list: { initialSegments: [cue(90000, 100500, 'Caption padding')] } }) }).run();
  assert.equal(clip.segments[0].end, 100, 'clip caption padding to the known media duration');
  const unknownDuration = await fixture({ duration: Infinity }).run();
  assert.equal(unknownDuration.duration, null);
  assert.ok(formats.output(formats.prepare({ id: ID, title: 'Known cue ends' }, unknownDuration), 'srt').text.includes('00:01:35,000'));
  console.log(`PASS: ${flavor} bounded/serialized transcript reader, ${failures.length} incomplete/navigation/language/network/timing failure cases, padding and unknown-duration support`);

  // Reproduce the user's modern-panel mismatch: no target-id, no legacy
  // renderer/language footer, one cached row, fresh 195-row response in chapters.
  const modernRows = Array.from({ length: 195 }, (_, index) => modernRow(
    Math.round(3 + index * 1416 / 194), `Modern passage ${index + 1}`));
  const longList = modernList();
  longList.contents = Array.from({ length: 10 }, (_, index) => ({ itemSectionRenderer: {
    ...modernList().contents[0].itemSectionRenderer, contents: modernRows.slice(index * 20, index * 20 + 20),
  } }));
  for (const options of [{}, { wrapped: true }, { closed: true, loadAfter: 3 }, { duration: Infinity }, { deepPage: true }]) {
    const fixtureCase = fixture({ modern: true, duration: 1500, ...options, response: modernResponse(longList) });
    const result = await fixtureCase.run();
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.source, 'youtube-panel-response');
    assert.equal(result.complete, true);
    assert.equal(result.segments.length, 195);
    assert.equal(result.segments[0].start, 3);
    assert.equal(result.segments.at(-1).start, 1419);
    assert.ok(result.segments.every(segment => segment.end === null));
    const validated = schema.validate('transcript', result, ID);
    const prepared = formats.prepare({ id: ID, title: 'Modern video' }, validated);
    for (const format of ['markdown-linked', 'markdown', 'text-timed', 'text', 'json']) {
      const output = formats.output(prepared, format);
      assert.ok(output.text.includes('Modern passage 1'));
      assert.ok(output.text.includes('Modern passage 195'));
    }
    assert.equal(JSON.parse(formats.output(prepared, 'json').text).segments.at(-1).end, null);
    for (const format of ['srt', 'vtt']) assert.throws(() => formats.output(prepared, format), /lacks cue end times/);
    assert.equal(fixtureCase.state.requests.length, 1);
  }
  const modernFailures = [
    [{ tokenId: 'bbbbbbbbbbb' }, /current-video/],
    [{ ambiguousModern: true }, /current-video/],
    [{ navigateDuringFetch: true }, /video changed/],
    [{ panelDuringFetch: true }, /language changed/],
    [{ response: { error: { code: 400 } } }, /not supported/],
    [{ response: {} }, /missing or ambiguous/],
    [{ response: modernResponse({ ...modernList(), continuations: [{}] }) }, /complete terminal/],
    [{ response: modernResponse({ ...modernList(), continuations: {} }) }, /complete terminal/],
    [{ response: modernResponse({ ...modernList(), isLoading: true }) }, /complete terminal/],
    [{ response: modernResponse({ ...modernList(), isComplete: false }) }, /complete terminal/],
    [{ response: modernResponse({ ...modernList(), nextPage: 'unknown' }) }, /unsupported content/],
    [{ response: { ...modernResponse(), other: modernResponse() } }, /missing or ambiguous/],
    [{ response: { ...modernResponse(), appendContinuationItemsAction: {} } }, /complete terminal/],
    [{ response: modernResponse({ ...modernList(), contents: [...modernList().contents, { continuationItemRenderer: {} }] }) }, /unknown or continued sections/],
    [{ response: modernResponse({ ...modernList(), contents: [{ itemSectionRenderer: {
      contents: [modernRow(3, 'First')], continuations: [{}],
    } }] }) }, /complete terminal/],
    [{ response: modernResponse(modernList([modernRow(3, 'First'), { continuationItemRenderer: {} }])) }, /unknown or continued rows/],
    [{ response: modernResponse(modernList([modernRow(3, 'Wrong video', 'bbbbbbbbbbb')])) }, /different video/],
    [{ response: modernResponse(modernList([modernRow('3', 'Invalid timing')])) }, /invalid cue timing/],
    [{ response: modernResponse(modernList([modernRow(5000, 'Outside media')])) }, /invalid cue timing/],
    [{ response: modernResponse(modernList([modernRow(90, 'Later'), modernRow(3, 'Earlier')])) }, /invalid cue timing/],
    [{ response: modernResponse(modernList([modernRow(3, '   ')])) }, /empty or too large/],
    [{ response: modernResponse(modernList([modernRow(3, 'x'.repeat(10001))])) }, /unreadable captions/],
    [{ networkError: true }, /Network failed/],
    [{ timeout: true }, /timed out/],
    [{ status: 403 }, /HTTP 403/],
    [{ truncated: true }, /incomplete or unrecognized/],
    [{ deepResponse: true }, /response structure exceeds supported limits/],
  ];
  for (const [options, message] of modernFailures) {
    const result = await fixture({ modern: true, ...options }).run();
    assert.match(result.error, message, JSON.stringify(options));
    assert.equal(result.segments, undefined);
  }
  console.log(`PASS: ${flavor} modern anonymous panel, fresh 195-row/10-chapter extraction, five exports, honest start-only timing, deep page metadata pruning, and ${modernFailures.length} failure guards`);
}
const timeout = setTimeout(() => { console.error('Transcript reader regression timed out'); process.exit(1); }, 10000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
