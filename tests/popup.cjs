const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const flavor = process.argv[2] || 'firefox';
const extension = path.resolve(__dirname, '../yt-waypoints-' + flavor);
const source = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const playerSource = fs.readFileSync(path.join(extension, 'player.js'), 'utf8');
async function popup(initial = {}, url = 'https://www.youtube.com/watch?v=test') {
  const data = structuredClone(initial);
  const listeners = [];
  let writes = 0;
  const doc = { activeElement: null, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
  class El {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.events = {}; this.hidden = false; this.disabled = true; this.value = ''; this.className = ''; this.classList = { contains: n => this.className.split(' ').includes(n), toggle: () => {}, add: () => {} }; }
    addEventListener(t, fn) { this.events[t] = fn; }
    setAttribute(k,v) { this[k] = v; }
    append(...els) { this.children.push(...els); }
    replaceChildren(...els) { this.children = els; }
    querySelectorAll(selector) { return this.children.flatMap(e => [...(selector === '.main' && e.className === 'main' ? [e] : []), ...e.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll('.main').find(e => selector.includes(`"${e.dataset.id}"`)); }
    scrollIntoView(options) { this.scrolled = options.block; }
    focus() { doc.activeElement = this; }
    click() { this.events.click?.(); }
  }
  const ids = ['show-thumbnails','shortcut-help','restore-bookmark','list','status','search','search-control','clear-search','hint','options-toggle','options-panel','auto-bookmark','scrub-seconds','shift-multiplier','scrub-value','multiplier-value','shift-preview'];
  const els = Object.fromEntries(ids.map(id => [id,new El()]));
  els['options-panel'].hidden = true;
  doc.querySelector = () => new El(); doc.getElementById = id => els[id]; doc.createElement = tag => new El(tag);
  // No runtime or permissions API is supplied: the popup must work without
  // thumbnail consent plumbing on both platforms.
  const browser = {
    storage: { local: { get: async key => structuredClone({[key]: data[key]}), set: async obj => { writes++; const changes = {}; for (const [k,v] of Object.entries(obj)) { changes[k] = {newValue: structuredClone(v)}; data[k] = structuredClone(v); } for (const fn of listeners) fn(changes, 'local'); } }, onChanged: { addListener: fn => listeners.push(fn) } },
    tabs: { query: async q => q.active ? [{id:1,url}] : [], create: async () => {} },
    scripting: { executeScript: async () => [{ result: {id:'test',t:100,duration:1000,title:'Test video'} }] },
  };
  const context = vm.createContext({ [flavor === "chrome" ? "chrome" : "browser"]: browser, document:doc, window:{close(){}}, URL, URLSearchParams, CSS:{escape:s=>s}, console });
  vm.runInContext(fs.readFileSync(path.join(extension, "platform.js"), "utf8"), context);
  vm.runInContext(playerSource, context);
  vm.runInContext(source, context);
  const settle = async () => { for(let i=0;i<40;i++) await Promise.resolve(); };
  await settle();
  assert.equal(els.search.disabled, false, els.status.textContent);
  return {data,els,doc,context,settle,writes:()=>writes};
}
(async () => {
  console.log('Popup target:', flavor);
  const initial = {settings:{autoBookmark:false}, videos:{
    a:{id:'a',title:'Dario and Daniela',t:100,updated:3},
    b:{id:'b',title:'Making Videos in Resolve',t:50,updated:2},
    c:{id:'c',title:'Video animation tips',t:20,updated:1},
  }};
  let p=await popup(initial);
  p.doc.listeners.keydown({key:"/",preventDefault(){}});
  const rows=()=>p.els.list.querySelectorAll('.main').map(e=>e.dataset.id);
  assert.deepEqual(rows(),['a','b','c']);
  p.els.search.value='VIDEO'; p.els.search.events.input();
  assert.deepEqual(rows(),['b','c']); assert.equal(p.els['clear-search'].hidden,false);
  assert.equal(p.writes(),0,'search must never change saved bookmarks');
  p.els.search.value='missing';p.els.search.events.input();
  assert.deepEqual(rows(),[]);assert.equal(p.els.list.children[0].textContent,'No matching videos.');
  p.els['clear-search'].click(); assert.deepEqual(rows(),['a','b','c']);
  assert.equal(p.els.search.value,''); assert.equal(p.els['clear-search'].hidden,true);
  assert.equal(p.doc.activeElement,p.els.search);
  for(const key of ['Backspace','Delete','ArrowLeft','ArrowRight',' ','Enter']) {
    let prevented=false; p.doc.listeners.keydown({key,preventDefault(){prevented=true;}});
    assert.equal(prevented,false,`search editing key ${key} must stay native`);
  }
  p.els.search.value='resolve'; p.els.search.events.input();
  p.doc.listeners.keydown({key:'ArrowDown',preventDefault(){}});
  assert.equal(p.doc.activeElement.dataset.id,'b');
  p.doc.listeners.keydown({key:'Delete',preventDefault(){}});await p.settle();
  assert.equal(p.data.videos.b,undefined);assert.ok(p.data.videos.a && p.data.videos.c);
  assert.equal(p.doc.activeElement,p.els['restore-bookmark']);
  assert.equal(p.els['search-control'].hidden,true);
  assert.equal(p.els['restore-bookmark'].hidden,false);
  p.doc.listeners.keydown({key:'/',preventDefault(){}});
  assert.equal(p.doc.activeElement,p.els.search);
  assert.equal(p.els['restore-bookmark'].hidden,true);
  assert.equal(p.els['search-control'].hidden,false);
  console.log('PASS: live title filtering, case-insensitive matching, empty state, clear, safe text editing, filtered-row navigation/deletion');
  p.els.search.value='Dario'; p.els.search.events.input();
  p.els['options-toggle'].click();
  assert.equal(p.els['search-control'].hidden,true);
  assert.equal(p.els.list.hidden,true);assert.equal(p.els['options-panel'].hidden,false);
  p.els['options-toggle'].click();
  assert.equal(p.els['search-control'].hidden,false);
  assert.equal(p.els.search.value,'Dario');assert.deepEqual(rows(),['a']);
  p.data.videos.a.title='Renamed title';await vm.runInContext('render()',p.context);
  assert.deepEqual(rows(),[],'storage refresh must keep applying current search');
  console.log('PASS: options hide search, restore query/filter, storage refresh respects search');
  p=await popup();assert.equal(p.data.videos.test.t,100);
  assert.equal(p.doc.activeElement.dataset.id,'test');
  assert.equal(p.doc.activeElement.scrolled,'nearest');
  let prevented=false;
  p.doc.listeners.keydown({key:'/',preventDefault(){prevented=true;}});
  assert.equal(prevented,true); assert.equal(p.doc.activeElement,p.els.search);
  p.els.search.value='video/'; prevented=false;
  p.doc.listeners.keydown({key:'/',preventDefault(){prevented=true;}});
  assert.equal(prevented,false); assert.equal(p.els.search.value,'video/');
  const firstRow=p.els.list.querySelectorAll('.main')[0]; firstRow.focus();
  p.doc.listeners.keydown({key:'/',ctrlKey:true,preventDefault(){throw Error('modified slash intercepted');}});
  assert.equal(p.doc.activeElement,firstRow);
  p.els['options-toggle'].click();
  p.doc.listeners.keydown({key:'/',preventDefault(){throw Error('hidden search focused');}});
  assert.equal(p.doc.activeElement,firstRow);
  p.els['options-toggle'].click();
  console.log('PASS: slash focuses search; slash typing, modifier shortcuts, and options mode remain unaffected');
  const existing=await popup({settings:{autoBookmark:false},videos:{test:{id:'test',title:'Current',t:70,updated:1},other:{id:'other',title:'Newer',t:10,updated:2}}});
  assert.equal(existing.doc.activeElement.dataset.id,'test');
  assert.equal(existing.data.videos.test.t,70);
  const unsaved=await popup({settings:{autoBookmark:false}});
  assert.equal(unsaved.doc.activeElement,unsaved.els['restore-bookmark']);
  assert.equal(unsaved.els['restore-bookmark'].hidden,false);
  assert.equal(unsaved.els['search-control'].hidden,true);
  assert.equal(unsaved.data.videos,undefined,'opening with auto-bookmark off must not save');
  unsaved.els['options-toggle'].click();assert.equal(unsaved.els['restore-bookmark'].hidden,true);
  unsaved.els['options-toggle'].click();assert.equal(unsaved.els['restore-bookmark'].hidden,false);
  unsaved.els['restore-bookmark'].click();await unsaved.settle();
  assert.equal(unsaved.data.videos.test.t,100);
  assert.equal(unsaved.data.settings.autoBookmark,false);
  assert.equal(unsaved.els['restore-bookmark'].hidden,true);
  assert.equal(unsaved.els['search-control'].hidden,false);
  const manualSearch=await popup({settings:{autoBookmark:false}});
  manualSearch.doc.listeners.keydown({key:'/',preventDefault(){}});
  assert.equal(manualSearch.doc.activeElement,manualSearch.els.search);
  await vm.runInContext('render()',manualSearch.context);
  assert.equal(manualSearch.els['restore-bookmark'].hidden,true,'storage refresh must not steal search');
  assert.equal(manualSearch.els['search-control'].hidden,false);
  const toggled=await popup(initial);
  await vm.runInContext('settings.autoBookmark = true',toggled.context);
  toggled.els['options-toggle'].click();
  toggled.els['auto-bookmark'].checked=false;
  toggled.els['auto-bookmark'].events.change();await toggled.settle();
  toggled.els['options-toggle'].click();
  assert.equal(toggled.els['restore-bookmark'].hidden,false);
  assert.equal(toggled.els['search-control'].hidden,true);
  assert.equal(existing.els['restore-bookmark'].hidden,true,'already saved video needs no Add button');
  assert.equal(existing.writes(),0,'existing position must not be overwritten');
  console.log('PASS: manual bookmark button with auto-bookmark off, save/return to search, slash override survives refresh, options toggle, existing bookmark untouched');
  const nonVideo=await popup({},'https://example.com/');
  assert.equal(nonVideo.doc.activeElement,nonVideo.els.search);
  console.log('PASS: bookmarked row focused/scrolled; unsaved video gets manual action; non-video page gets search');
  p.els.search.value='no match';p.els.search.events.input();
  assert.equal(p.data.videos.test.t,100);
  console.log('PASS: default auto-bookmark retained');
  const scrubber=await popup({settings:{autoBookmark:false,scrubSeconds:7,shiftMultiplier:4},videos:{test:{id:'test',title:'Saved',t:100,duration:1000,updated:1}}});
  scrubber.doc.listeners.keydown({key:'ArrowRight',preventDefault(){}});await scrubber.settle();
  assert.equal(scrubber.data.videos.test.t,107);
  scrubber.doc.listeners.keydown({key:'ArrowLeft',shiftKey:true,preventDefault(){}});await scrubber.settle();
  assert.equal(scrubber.data.videos.test.t,79);
  console.log('PASS: ordinary popup uses saved arrow scrub distance and Shift multiplier');
  const undo=await popup(initial);
  await vm.runInContext('deleteVideo("b")',undo.context);
  assert.equal(undo.els['restore-bookmark'].hidden,false);
  assert.equal(undo.els['search-control'].hidden,true);
  undo.els['options-toggle'].click();assert.equal(undo.els['restore-bookmark'].hidden,true);
  undo.els['options-toggle'].click();assert.equal(undo.els['restore-bookmark'].hidden,false);
  undo.els['restore-bookmark'].click();await undo.settle();
  assert.deepEqual(undo.data.videos.b,initial.videos.b,'restore exact deleted entry/time, not the active video');
  assert.equal(undo.els['restore-bookmark'].hidden,true);
  assert.equal(undo.els['search-control'].hidden,false);
  await vm.runInContext('deleteVideo("b");',undo.context);
  await vm.runInContext('deleteVideo("c");',undo.context);
  undo.els['restore-bookmark'].click();await undo.settle();
  assert.equal(undo.data.videos.b,undefined);assert.deepEqual(undo.data.videos.c,initial.videos.c);
  await vm.runInContext('deleteVideo("c")',undo.context);
  undo.data.videos.c={...initial.videos.c,t:999};
  undo.els['restore-bookmark'].click();await undo.settle();
  assert.equal(undo.data.videos.c.t,999,'undo must not overwrite a newly saved entry');
  console.log('PASS: deletion shows restore button, undo preserves original bookmark, latest deletion wins, slash returns to search, options hide button, newer saves preserved');
  const defaults=await popup(initial);
  assert.equal(defaults.els['show-thumbnails'].checked,true,'missing preference defaults to on');
  const thumbs=await popup({...initial,settings:{...initial.settings,showThumbnails:false}});
  // Use tag-aware traversal for img checks, independent of row markup.
  const collect=(el,tag)=>el.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...collect(c,tag)]);
  assert.equal(collect(defaults.els.list,'img').length,3,'default setting renders thumbnails');
  assert.equal(collect(thumbs.els.list,'img').length,0,'explicit off preference is preserved');
  const row=thumbs.els.list.querySelectorAll('.main')[1];row.focus();
  thumbs.doc.listeners.keydown({key:'t',preventDefault(){}});await thumbs.settle();
  assert.equal(thumbs.els['options-panel'].hidden,true,'t toggles without opening Options or a confirmation');
  assert.equal(thumbs.data.settings.showThumbnails,true);
  assert.equal(thumbs.els['show-thumbnails'].checked,true);
  assert.equal(thumbs.doc.activeElement.dataset.id,row.dataset.id);
  let imgs=collect(thumbs.els.list,'img');assert.equal(imgs.length,3);
  assert.equal(imgs[0].src,'https://i.ytimg.com/vi/a/mqdefault.jpg');
  assert.equal(imgs[0].referrerPolicy,'no-referrer');assert.equal(imgs[0].loading,'lazy');
  imgs[0].events.error();assert.equal(imgs[0].hidden,true,'unavailable image hides broken-image icon');
  const writes=thumbs.writes();
  thumbs.doc.listeners.keydown({key:'t',repeat:true,preventDefault(){}});await thumbs.settle();
  assert.equal(thumbs.writes(),writes,'held shortcut toggles only once');
  thumbs.doc.listeners.keydown({key:'t',ctrlKey:true,preventDefault(){throw Error('modified t intercepted');}});
  thumbs.els.search.focus();
  thumbs.doc.listeners.keydown({key:'t',preventDefault(){throw Error('search t intercepted');}});
  assert.equal(thumbs.data.settings.showThumbnails,true);
  thumbs.els['options-toggle'].click();
  thumbs.els['show-thumbnails'].checked=false;thumbs.els['show-thumbnails'].events.change();await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails,false);assert.equal(collect(thumbs.els.list,'img').length,0);
  thumbs.els['show-thumbnails'].checked=true;thumbs.els['show-thumbnails'].events.change();await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails,true);
  thumbs.els['scrub-seconds'].value='12';thumbs.els['shift-multiplier'].value='4';
  thumbs.els['scrub-seconds'].events.change();await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails,true,'other preference edits preserve thumbnail choice');
  const reopened=await popup(thumbs.data);
  assert.equal(reopened.els['show-thumbnails'].checked,true,'preference survives reopening');
  assert.equal(collect(reopened.els.list,'img').length,3);
  thumbs.els['options-toggle'].click();thumbs.els.search.value='resolve';thumbs.els.search.events.input();
  assert.equal(collect(thumbs.els.list,'img').length,1,'only matching rows load images');
  const upgraded=await popup({...initial,settings:{autoBookmark:false,showThumbnails:true,thumbnailNoticeAccepted:true}});
  assert.equal(upgraded.els['show-thumbnails'].checked,true,'existing thumbnail preference survives the update');
  assert.equal(collect(upgraded.els.list,'img').length,3);
  console.log('PASS: direct thumbnail shortcut/checkbox without permissions API; setting persists; typing/modifiers/repeat safe; filtered images/focus/error fallback; upgrade keeps preference');

})().catch(e=>{console.error(e);process.exitCode=1;});
