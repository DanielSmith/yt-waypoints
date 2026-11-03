const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const flavor = process.argv[2] || 'firefox';
const extension = path.resolve(__dirname, '../yt-waypoints-' + flavor);
const source = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const playerSource = fs.readFileSync(path.join(extension, 'player.js'), 'utf8');
async function popup(initial = {}, url = 'https://www.youtube.com/watch?v=test', behavior = {}) {
  const data = structuredClone(initial);
  const listeners = [];
  let writes = 0;
  let closeCount = 0;
  let importNumber = 0;
  const navigation = [];
  const executions = [];
  const clipboardWrites = [];
  const doc = { activeElement: null, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
  class El {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.style = {setProperty(name,value){this[name]=value;}}; this.events = {}; this.hidden = false; this.disabled = true; this.value = ''; this.className = ''; this.classList = { contains: n => this.className.split(' ').includes(n), toggle: () => {}, add: () => {}, remove: () => {} }; }
    showModal() { this.open = true; els['help-close'].focus(); }
    close() { this.open = false; }
    addEventListener(t, fn) { this.events[t] = fn; }
    setAttribute(k,v) { this[k] = v; }
    append(...els) { for(const el of els) el.parentNode=this; this.children.push(...els); }
    remove() { if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(el=>el!==this); }
    replaceChildren(...els) { this.children = els; }
    querySelectorAll(selector) { return this.children.flatMap(e => [...(selector === '.main' && e.className === 'main' ? [e] : []), ...e.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll('.main').find(e => selector.includes(`"${e.dataset.id}"`)); }
    scrollIntoView(options) { this.scrolled = options.block; }
    select() { this.selectionStart=0;this.selectionEnd=this.value.length; }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
    setPointerCapture(id) { this.capturedPointer = id; }
    focus() { doc.activeElement = this; }
    click() { this.events.click?.(); }
  }
  const ids = ['help-escape','help-dialog','help-toggle','help-close','help-scrub','help-multiplier','copy-videos','include-channel-names','show-thumbnails','shortcut-help','restore-bookmark','list','status','search','search-control','clear-search','hint','options-toggle','options-panel','auto-bookmark','scrub-seconds','shift-multiplier','scrub-value','multiplier-value','shift-preview'];
  const els = Object.fromEntries(ids.map(id => [id,new El()]));
  els['options-panel'].hidden = true;
  doc.body = new El('body');
  doc.execCommand = command => {
    const field=doc.body.children.find(el=>el.tag==='textarea');
    if(command!=='copy'||!field||behavior.failLegacyClipboard)return false;
    clipboardWrites.push(field.value);return true;
  };
  doc.querySelector = () => new El(); doc.getElementById = id => els[id]; doc.createElement = tag => new El(tag);
  // No runtime or permissions API is supplied: the popup must work without
  // thumbnail consent plumbing on both platforms.
  const browser = {
    storage: { local: { get: async key => structuredClone({[key]: data[key]}), set: async obj => { writes++; const changes = {}; for (const [k,v] of Object.entries(obj)) { changes[k] = {newValue: structuredClone(v)}; data[k] = structuredClone(v); } for (const fn of listeners) fn(changes, 'local'); } }, onChanged: { addListener: fn => listeners.push(fn) } },
    tabs: {
      query: async q => q.active ? [{id:1,windowId:1,url}] : (behavior.tabs || []),
      update: async (id,changes) => {
        if(behavior.failNavigation) throw Error('Navigation failed');
        navigation.push({type:'update',id,...changes});
      },
      create: async changes => {
        if(behavior.failNavigation) throw Error('Navigation failed');
        navigation.push({type:'create',...changes});
      },
    },
    windows:{update:async(id,changes)=>navigation.push({type:'window',id,...changes})},
    scripting: { executeScript: async request => {
      executions.push({operation:request.func.name,args:Array.from(request.args||[]),tabId:request.target.tabId});
      if(behavior.executeScript) return behavior.executeScript(request,data);
      return [{ result: behavior.metadata || {id:'test',t:100,duration:1000,title:'Test video'} }];
    } },
  };
  const context = vm.createContext({ [flavor === "chrome" ? "chrome" : "browser"]: browser, document:doc, window:{close(){closeCount++;}}, crypto:{randomUUID:()=>"import-"+(++importNumber)}, navigator:{clipboard:{writeText:async text=>{
    if(behavior.failClipboard)throw Error('Clipboard unavailable');clipboardWrites.push(text);
  }}}, URL, URLSearchParams, CSS:{escape:s=>s}, console });
  vm.runInContext(fs.readFileSync(path.join(extension, "platform.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(extension, 'transfer.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(extension, 'metadata.js'), 'utf8'), context);
  vm.runInContext(playerSource, context);
  vm.runInContext(source, context);
  const settle = async () => { for(let i=0;i<40;i++) await Promise.resolve(); };
  await settle();
  assert.equal(els.search.disabled, false, els.status.textContent);
  return {data,els,doc,context,settle,navigation,executions,clipboardWrites,closed:()=>closeCount,writes:()=>writes,
    async paste(text) {
      let prevented=false;
      doc.listeners.paste({clipboardData:{getData:()=>text},preventDefault(){prevented=true;}});
      await settle();return prevented;
    },
  };
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
  scrubber.doc.listeners.keydown({key:'>',preventDefault(){}});await scrubber.settle();
  assert.equal(scrubber.data.videos.test.t,86);
  scrubber.doc.listeners.keydown({key:'<',shiftKey:true,preventDefault(){}});await scrubber.settle();
  assert.equal(scrubber.data.videos.test.t,58);
  scrubber.doc.listeners.keydown({key:'.',preventDefault(){}});await scrubber.settle();
  assert.equal(scrubber.data.videos.test.t,65);
  scrubber.doc.listeners.keydown({key:',',preventDefault(){}});await scrubber.settle();
  assert.equal(scrubber.data.videos.test.t,58);
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
  const videoId='dQw4w9WgXcQ';
  const pasted=await popup({settings:{autoBookmark:false}});
  assert.equal(pasted.doc.activeElement,pasted.els['restore-bookmark']);
  assert.equal(await pasted.paste(`https://youtu.be/${videoId}?si=tracking&t=1m30s`),true);
  assert.deepEqual(pasted.navigation,[{type:'update',id:1,url:`https://www.youtube.com/watch?v=${videoId}&t=90s`}]);
  assert.equal(pasted.els.search.value,'');assert.equal(pasted.els['clear-search'].hidden,true);
  assert.equal(pasted.els['search-control'].hidden,false);assert.equal(pasted.closed(),1);
  assert.equal(pasted.writes(),0,'pasting does not modify bookmarks');
  const bookmark={id:videoId,title:'Saved',t:123,duration:1000,updated:1};
  const saved={settings:{autoBookmark:false},videos:{[videoId]:bookmark}};
  const tab={id:9,windowId:3,url:`https://www.youtube.com/watch?v=${videoId}`};
  const existingPaste=await popup(saved,undefined,{tabs:[tab]});
  await existingPaste.paste(tab.url+'&ignored=invalid');
  assert.deepEqual(existingPaste.navigation,[{type:'window',id:3,focused:true},{type:'update',id:9,active:true}]);
  const timed=await popup(saved,undefined,{tabs:[tab]});
  await timed.paste(tab.url+'&t=80');
  assert.equal(timed.navigation[0].url,tab.url+'&t=80s');
  assert.equal(timed.navigation.at(-1).active,true);
  const newTab=await popup(saved,'https://example.com/');
  newTab.els['options-toggle'].click();
  await newTab.paste(tab.url+'&list=playlist&si=tracking');
  assert.deepEqual(newTab.navigation,[{type:'create',url:tab.url+'&t=123s'}]);
  assert.equal(newTab.els['options-panel'].hidden,true);
  const queryPaste=await popup(initial);queryPaste.els.search.focus();
  await queryPaste.paste(tab.url);assert.equal(queryPaste.closed(),1);
  const textPaste=await popup(initial);textPaste.els.list.querySelectorAll('.main')[0].focus();
  assert.equal(await textPaste.paste('VIDEO'),true);
  assert.equal(textPaste.doc.activeElement,textPaste.els.search);
  assert.deepEqual(textPaste.els.list.querySelectorAll('.main').map(r=>r.dataset.id),['b','c']);
  assert.equal(textPaste.navigation.length,0);assert.equal(textPaste.closed(),0);
  assert.equal(await textPaste.paste('more text'),false,'ordinary paste in search uses native text editing');
  const failed=await popup({settings:{autoBookmark:false}},undefined,{failNavigation:true});
  await failed.paste(tab.url);
  assert.equal(failed.closed(),0);assert.equal(failed.els.search.value,tab.url);
  assert.equal(failed.els.status.textContent,'Navigation failed');
  const parsed=value=>JSON.parse(vm.runInContext('JSON.stringify(parseVideoLink('+JSON.stringify(value)+'))',pasted.context));
  for(const link of [tab.url,`https://youtube.com/watch?v=${videoId}`,`www.youtube.com/watch?v=${videoId}`,`https://m.youtube.com/shorts/${videoId}`,`https://www.youtube.com/live/${videoId}`,`https://www.youtube.com/embed/${videoId}`]) {
    assert.deepEqual(parsed(link),{id:videoId,t:null});
  }
  assert.equal(parsed(tab.url+'&t=1h2m3s').t,3723);
  assert.equal(parsed(tab.url+'#t=45s').t,45);
  assert.equal(parsed(`https://www.youtube.com/embed/${videoId}?start=0`).t,0);
  for(const invalid of [
    'javascript:alert(1)','data:text/html,test','file:///tmp/video',
    `https://www.youtube.com.evil.example/watch?v=${videoId}`,
    `https://youtube.com@evil.example/watch?v=${videoId}`,
    `https://someone@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:8443/watch?v=${videoId}`,
    `https://www.youtube.com/redirect?q=${encodeURIComponent(tab.url)}`,
    `https://www.youtube.com/channel/${videoId}`,
    tab.url+'&v=aaaaaaaaaaa',tab.url+'&t=-1',tab.url+'&t=oops',
    tab.url+'&t=999999999999999999999999','https://youtube.com/watch?v=short',
    'https://youtube.com/watch?v=%3Cscript%3E',tab.url+' '+tab.url,
  ]) {
    assert.equal(parsed(invalid),null,invalid);
    const bad=await popup({settings:{autoBookmark:false}});
    await bad.paste(invalid);
    assert.equal(bad.navigation.length,0,invalid);assert.equal(bad.writes(),0);
  }
  console.log('PASS: paste anywhere navigates using canonical YouTube links, honors timestamps/resume points, clears search on success, keeps failed input, text filters normally, unsafe URLs never navigate');
  const channelData={settings:{autoBookmark:false,showThumbnails:false},videos:{
    a:{id:'a',title:'The EV push',channelName:'Bloomberg',channelUrl:'https://www.youtube.com/@Bloomberg',t:30,updated:2},
    b:{id:'b',title:'Bloomberg interview recap',channelName:'Tech Talks',t:15,updated:1},
    c:{id:'c',title:'Old bookmark',t:10,updated:0},
  }};
  const channels=await popup(channelData);
  assert.equal(channels.els['include-channel-names'].checked,true);
  channels.doc.listeners.keydown({key:'/',preventDefault(){}});
  channels.els.search.value='bLoOmBeRg';channels.els.search.events.input();
  const channelRows=()=>channels.els.list.querySelectorAll('.main').map(r=>r.dataset.id);
  assert.deepEqual(channelRows(),['a','b'],'default search matches channel or title, ignoring case');
  channels.els['options-toggle'].click();
  channels.els['include-channel-names'].checked=false;
  channels.els['include-channel-names'].events.change();await channels.settle();
  assert.deepEqual(channelRows(),['b'],'disabling channel search keeps title matches');
  assert.equal(channels.data.settings.includeChannelNames,false);
  channels.els['options-toggle'].click();
  const channelReopen=await popup(channels.data);
  assert.equal(channelReopen.els['include-channel-names'].checked,false,'explicit off preference persists');
  channels.els['options-toggle'].click();
  channels.els['include-channel-names'].checked=true;
  channels.els['include-channel-names'].events.change();await channels.settle();
  assert.deepEqual(channelRows(),['a','b']);
  assert.deepEqual(channels.data.videos,channelData.videos,'search preference never edits bookmarks');
  const legacy={settings:{autoBookmark:false},videos:{test:{id:'test',title:'Original title',t:42,duration:1000,updated:123}}};
  const metadata={id:'test',title:'Page title',t:900,duration:1000,channelName:'Bloomberg',channelUrl:'https://www.youtube.com/@Bloomberg'};
  const enriched=await popup(legacy,undefined,{metadata});
  assert.equal(enriched.data.videos.test.channelName,'Bloomberg');
  assert.equal(enriched.data.videos.test.t,42);assert.equal(enriched.data.videos.test.updated,123);
  assert.equal(enriched.data.videos.test.title,'Original title');
  assert.equal(enriched.writes(),1);
  const present=await popup(enriched.data,undefined,{metadata});assert.equal(present.writes(),0);
  const unavailable=await popup(enriched.data);assert.equal(unavailable.data.videos.test.channelName,'Bloomberg');
  const wrong=await popup(legacy,undefined,{metadata:{...metadata,id:'previous'}});
  assert.equal(wrong.data.videos.test.channelName,undefined);assert.equal(wrong.writes(),0);
  const newBookmark=await popup({settings:{autoBookmark:false}},undefined,{metadata});
  newBookmark.els['restore-bookmark'].click();await newBookmark.settle();
  assert.equal(newBookmark.data.videos.test.channelName,'Bloomberg');
  console.log('PASS: case-insensitive title/channel search, default on, persisted off toggle, missing channel tolerated, channel capture/backfill preserves saved time and recency');
  const seekData={settings:{autoBookmark:false,scrubSeconds:7,shiftMultiplier:4},videos:{test:{id:'test',title:'Scrub me',t:100,duration:1000,updated:123}}};
  const drag=await popup(seekData,'https://example.com/');
  const findSlider=()=>{
    const walk=el=>el.className==='bar'?el:el.children.map(walk).find(Boolean);
    return walk(drag.els.list);
  };
  let slider=findSlider();assert.equal(slider.type,'range');assert.equal(slider.value,'100');
  let stopped=false;slider.events.click({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
  slider.events.pointerdown({button:0,pointerId:1,stopPropagation(){}});
  slider.value='650';slider.events.input();
  assert.equal(drag.data.videos.test.t,100,'drag only previews before release');assert.equal(drag.writes(),0);
  assert.equal(slider.style['--progress'],'65%');
  drag.data.videos.extra={id:'extra',title:'Concurrent bookmark',t:5,duration:60,updated:1};
  drag.data.videos.test.t=105;
  await vm.runInContext('render()',drag.context);
  assert.equal(findSlider(),slider,'autosave rerender keeps the native dragging element');
  assert.equal(slider.value,'650');
  slider.events.pointerup();slider.events.change();await drag.settle();
  assert.equal(drag.data.videos.test.t,650);assert.equal(drag.data.videos.test.updated,123);
  assert.equal(drag.writes(),1,'pointerup/change commits once');assert.ok(drag.data.videos.extra);
  assert.equal(drag.navigation.length,0);assert.equal(drag.closed(),0);
  slider=findSlider();slider.events.pointerdown({button:0,pointerId:2,stopPropagation(){}});
  slider.value='850';slider.events.input();slider.events.pointercancel();slider.events.change();await drag.settle();
  assert.equal(drag.data.videos.test.t,650,'cancelled drag restores original saved position');
  assert.equal(findSlider().value,'650');assert.equal(drag.writes(),1);
  slider=findSlider();slider.events.pointerdown({button:0,pointerId:3,stopPropagation(){}});slider.events.pointerup();await drag.settle();
  assert.equal(drag.writes(),1,'clicking an unchanged position cannot freeze rendering or write');
  slider=findSlider();slider.focus();slider.events.keydown({key:'ArrowRight',shiftKey:true,preventDefault(){},stopPropagation(){}});await drag.settle();
  assert.equal(drag.data.videos.test.t,678,'slider keyboard follows configured Shift multiplier');
  const live=await popup(seekData,'https://example.com/',{
    tabs:[{id:7,windowId:1,url:'https://www.youtube.com/watch?v=test'}],
    executeScript:async(request,data)=>{
      data.videos.late={id:'late',title:'Added while seeking',t:2,duration:50};
      return [{result:{t:750,duration:1000,paused:true}}];
    },
  });
  const liveSlider=live.els.list.querySelectorAll('.main')[0].children.find(c=>c.className==='details').children.find(c=>c.className==='bar');
  liveSlider.value='750';liveSlider.events.input();liveSlider.events.change();await live.settle();
  assert.equal(live.data.videos.test.t,750);assert.ok(live.data.videos.late);
  assert.deepEqual(live.executions.at(-1),{operation:'seekTo',args:[750],tabId:7});
  assert.equal(live.navigation.length,0);assert.equal(live.closed(),0);
  assert.ok(live.els.status.textContent.includes('Paused'));
  console.log('PASS: drag preview/commit/cancel, no row-open click, active drag survives autosave, single commit, configured keyboard steps, live seek and saved-only seek preserve other bookmarks');
  const a='aaaaaaaaaaa',b='bbbbbbbbbbb',c='ccccccccccc',d='ddddddddddd';
  const record=(id,t,updated)=>({id,title:'Video '+id,t,duration:1000,updated});
  const local={settings:{autoBookmark:false,showThumbnails:false,includeChannelNames:false},videos:{[a]:record(a,10,100),[b]:record(b,80,300),[d]:record(d,1,9)}};
  const shortcuts=await popup(local,'https://example.com/');
  const key=async (key,extra={})=>{shortcuts.doc.listeners.keydown({key,preventDefault(){},stopPropagation(){},...extra});await shortcuts.settle();};
  shortcuts.els.search.value='Video '+b;shortcuts.els.search.events.input();
  shortcuts.els.list.querySelectorAll('.main')[0].focus();
  await key('u');assert.equal(shortcuts.clipboardWrites.at(-1),`https://www.youtube.com/watch?v=${b}&t=80s`);
  await key('c');
  const single=JSON.parse(shortcuts.clipboardWrites.at(-1));
  assert.deepEqual(single,{format:'yt-waypoints',version:1,videos:{[b]:local.videos[b]}});
  const singleTarget=await popup({settings:{autoBookmark:false}},'https://example.com/');
  await singleTarget.paste(shortcuts.clipboardWrites.at(-1));assert.deepEqual(singleTarget.data.videos,single.videos);
  await key('C',{shiftKey:true});assert.deepEqual(JSON.parse(shortcuts.clipboardWrites.at(-1)).videos,local.videos);
  const copies=shortcuts.clipboardWrites.length;
  for(const name of ['u','c','C']) {
    await key(name,{repeat:true});
    await key(name,{metaKey:true});await key(name,{ctrlKey:true});await key(name,{altKey:true});
  }
  assert.equal(shortcuts.clipboardWrites.length,copies);
  await key('?');assert.equal(shortcuts.els['help-dialog'].open,true);
  assert.equal(shortcuts.doc.activeElement,shortcuts.els['help-close']);
  assert.equal(shortcuts.els['help-scrub'].textContent,'Scrub 10 seconds');
  assert.equal(shortcuts.els['help-multiplier'].textContent,'×3 (30 seconds)');
  await key('?',{repeat:true});assert.equal(shortcuts.els['help-dialog'].open,true);
  for(const name of ['Delete','t','C','ArrowRight','Enter']) await key(name);
  assert.equal(await shortcuts.paste(JSON.stringify({videos:{[a]:record(a,999,100)}})),false);
  assert.deepEqual(shortcuts.data,local,'help isolates background actions');
  assert.equal(shortcuts.clipboardWrites.length,copies);
  // Storage-driven rerenders replace the focused row while help is visible.
  await vm.runInContext('render()',shortcuts.context);
  await key('h');assert.equal(shortcuts.els['help-dialog'].open,false);
  assert.equal(shortcuts.doc.activeElement,shortcuts.els.list.querySelectorAll('.main')[0]);
  shortcuts.els['help-toggle'].click();assert.equal(shortcuts.els['help-dialog'].open,true);
  let escapePrevented=0,escapeStopped=0;
  const escapeEvent={key:'Escape',preventDefault(){escapePrevented++;},stopPropagation(){escapeStopped++;}};
  shortcuts.doc.listeners.keydown(escapeEvent);
  shortcuts.doc.listeners.keydown({...escapeEvent,repeat:true});
  shortcuts.doc.listeners.keyup(escapeEvent);
  if(flavor==='firefox') {
    assert.equal(escapePrevented,0,'Firefox owns popup dismissal; do not pretend to suppress it');
    assert.equal(escapeStopped,0);
    assert.equal(shortcuts.els['help-escape'].textContent,'Close entire popup (Firefox)');
    await key('h');
  } else {
    assert.equal(escapePrevented,3,'consume Escape down, held repeats, and release');
    assert.equal(escapeStopped,3,'consume Escape propagation within the document');
    assert.equal(shortcuts.els['help-escape'].textContent,'Close help');
  }
  assert.equal(shortcuts.els['help-dialog'].open,false);
  assert.equal(shortcuts.closed(),0,'extension code never calls window.close for help');
  shortcuts.doc.listeners.keydown({key:'Escape',preventDefault(){throw Error('ordinary popup Escape intercepted');}});
  shortcuts.doc.listeners.keyup({key:'Escape',preventDefault(){throw Error('ordinary popup Escape release intercepted');}});
  await key('h');shortcuts.els['help-close'].click();assert.equal(shortcuts.els['help-dialog'].open,false);
  shortcuts.els.search.focus();
  for(const name of ['?','h','u','c','C','<','>']) await key(name,{preventDefault(){throw Error('search typing intercepted');}});
  assert.equal(shortcuts.clipboardWrites.length,copies);
  shortcuts.els['options-toggle'].click();shortcuts.els['options-toggle'].focus();
  await key('C');assert.deepEqual(JSON.parse(shortcuts.clipboardWrites.at(-1)).videos,local.videos);
  await key('h');assert.equal(shortcuts.els['help-dialog'].open,true);
  await key(flavor==='firefox'?'h':'Escape');assert.equal(shortcuts.doc.activeElement,shortcuts.els['options-toggle']);
  console.log('PASS: row URL/JSON and all-JSON shortcuts, importable single export, filter/modifier/repeat/search safety, modal help isolation and focus restoration');
  const transferPopup=await popup(local,'https://example.com/');
  transferPopup.els['options-toggle'].click();
  transferPopup.els['copy-videos'].click();await transferPopup.settle();
  assert.equal(transferPopup.clipboardWrites.length,1);
  assert.deepEqual(JSON.parse(transferPopup.clipboardWrites[0]).videos,local.videos);
  assert.equal(JSON.parse(transferPopup.clipboardWrites[0]).settings,undefined);
  const incoming={format:'yt-waypoints',version:1,videos:{[a]:record(a,60,200),[b]:record(b,5,100),[c]:record(c,20,150)}};
  assert.equal(await transferPopup.paste(JSON.stringify(incoming)),true);
  assert.equal(transferPopup.data.videos[a].t,60);assert.equal(transferPopup.data.videos[b].t,5);
  assert.ok(transferPopup.data.videos[c]);assert.ok(transferPopup.data.videos[d]);
  assert.deepEqual(transferPopup.data.settings,local.settings);
  assert.equal(transferPopup.navigation.length,0);assert.equal(transferPopup.closed(),0);
  assert.equal(transferPopup.els.search.value,'');assert.equal(transferPopup.els['options-panel'].hidden,true);
  assert.equal(transferPopup.els.status.textContent,'Import: 1 added, 2 updated, 0 unchanged.');
  const repeatWrites=transferPopup.writes();await transferPopup.paste(JSON.stringify(incoming));
  assert.equal(transferPopup.writes(),repeatWrites+1,'repeated import renews the open-player handoff');
  const beforeWrites=transferPopup.writes();
  const before=JSON.stringify(transferPopup.data);
  await transferPopup.paste(JSON.stringify({videos:{[c]:record(c,30,999),[a]:{id:a,t:-1}}}));
  assert.equal(JSON.stringify(transferPopup.data),before,'invalid later record cannot partially import earlier valid record');
  assert.ok(transferPopup.els.status.textContent.startsWith('Import failed:'));
  assert.equal(transferPopup.writes(),beforeWrites);
  await transferPopup.paste('{bad json');assert.equal(JSON.stringify(transferPopup.data),before);
  assert.equal(transferPopup.writes(),beforeWrites);
  const fallbackCopy=await popup(local,'https://example.com/',{failClipboard:true});
  fallbackCopy.els['options-toggle'].click();fallbackCopy.els['copy-videos'].focus();
  fallbackCopy.els['copy-videos'].click();await fallbackCopy.settle();
  assert.deepEqual(JSON.parse(fallbackCopy.clipboardWrites[0]).videos,local.videos);
  assert.equal(fallbackCopy.doc.body.children.length,0,'temporary copy field is always removed');
  assert.equal(fallbackCopy.doc.activeElement,fallbackCopy.els['copy-videos']);
  const failedCopy=await popup(local,'https://example.com/',{failClipboard:true,failLegacyClipboard:true});
  failedCopy.els['copy-videos'].click();await failedCopy.settle();
  assert.equal(failedCopy.clipboardWrites.length,0);
  assert.equal(failedCopy.doc.body.children.length,0);
  assert.equal(failedCopy.els.status.textContent,'Could not copy JSON. Please try again.');
  const roundTrip=await popup({settings:{autoBookmark:false}},'https://example.com/');
  await roundTrip.paste(transferPopup.clipboardWrites[0]);
  assert.deepEqual(roundTrip.data.videos,local.videos);
  const strict=await popup({settings:{autoBookmark:false,showThumbnails:false}},'https://example.com/');
  const badFields={...record(c,20,100),title:'<img src=x onerror=bad()>',url:'javascript:bad()',thumbnail:'https://evil.example/x',settings:{injected:true},constructor:{polluted:true}};
  await strict.paste(JSON.stringify({format:'yt-waypoints',version:1,videos:{[c]:badFields},settings:{showThumbnails:true},unknown:['drop']}));
  assert.deepEqual(Object.keys(strict.data.videos[c]).sort(),['duration','id','t','title','updated']);
  assert.equal(strict.data.videos[c].title,'<img src=x onerror=bad()>');
  assert.equal(strict.data.settings.showThumbnails,false);
  assert.equal(strict.navigation.length,0);
  const stored=JSON.stringify(strict.data);const strictWrites=strict.writes();
  await strict.paste(JSON.stringify({videos:{[a]:record(a,5,300),[b]:{...record(b,2,300),t:'2'}}}));
  assert.equal(JSON.stringify(strict.data),stored);assert.equal(strict.writes(),strictWrites);
  const activeImport=await popup({settings:{autoBookmark:false},videos:{[a]:record(a,85,1793659999999)}},'https://example.com/',{
    tabs:[{id:7,windowId:1,url:'https://www.youtube.com/watch?v='+a}],
    executeScript:async()=>[{result:{t:796,duration:1000,paused:true}}],
  });
  await activeImport.paste(JSON.stringify({videos:{[a]:record(a,796,1793656321686)}}));
  assert.equal(activeImport.data.videos[a].t,796);
  assert.deepEqual(activeImport.executions.at(-1),{operation:'seekTo',args:[796,a],tabId:7});
  assert.equal(activeImport.data.importedPositions.videos[a].t,796);
  console.log('PASS: Options JSON export/copy and offscreen fallback, paste merge stays open, pasted source wins, settings/unrelated rows preserved, invalid JSON is atomic, repeated import unchanged, cross-browser-ready round trip');





})().catch(e=>{console.error(e);process.exitCode=1;});
