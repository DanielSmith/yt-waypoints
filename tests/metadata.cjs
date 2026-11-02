const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const flavor=process.argv[2]||'firefox';
const read=name=>fs.readFileSync(path.join(__dirname,'../yt-waypoints-'+flavor,name),'utf8');
function fixture(overrides={}, initial={videos:{test:{id:'test',t:20,duration:1000,updated:1}}}) {
  const state={owner:true,ownerId:'test',channelName:'Bloomberg',href:'/@Bloomberg?tracking=drop#section',...overrides};
  const video={currentTime:80,duration:1000,paused:false};
  const anchor={get textContent(){return state.channelName;},getAttribute(){return state.href;}};
  const getOwner=selector=>selector.includes('#owner')||selector.includes('ytm-slim-owner-renderer')
    ? (state.owner?anchor:null) : {textContent:'Unrelated recommendation',getAttribute(){return '/@Unrelated';}};
  const watch={getAttribute:()=>state.ownerId,querySelector:getOwner};
  const document={title:'(3) Example - YouTube',visibilityState:'visible',listeners:{},
    querySelector(selector){
      if(selector==='video')return video;
      if(selector.includes('ad-showing'))return state.ad?{}:null;
      if(selector==='ytd-watch-flexy:not([hidden])')return state.mobile?null:watch;
      return getOwner(selector);
    },addEventListener(n,fn){this.listeners[n]=fn;},
  };
  const data=structuredClone(initial);let writes=0;const subscribers=[];
  let holdNext=false,releaseRead;
  function emit(value) {
    const changes={};
    for(const [key,item] of Object.entries(value)) {changes[key]={newValue:structuredClone(item)};data[key]=structuredClone(item);}
    for(const fn of subscribers)fn(changes,'local');
  }
  const api={storage:{onChanged:{addListener:fn=>subscribers.push(fn)},local:{
    get:async key=>{
      const snapshot=structuredClone(Array.isArray(key)?Object.fromEntries(key.map(k=>[k,data[k]])):{[key]:data[key]});
      if(holdNext) {holdNext=false;await new Promise(resolve=>releaseRead=resolve);}
      return snapshot;
    },set:async value=>{writes++;emit(value);},
  }}};
  const globals={document,location:{pathname:'/watch',search:'?v=test',href:'https://www.youtube.com/watch?v=test'},URL,URLSearchParams};
  const context=vm.createContext({...globals,[flavor==='chrome'?'chrome':'browser']:api,window:{addEventListener(){}},setInterval(fn,ms){assert.equal(ms,5000);}});
  vm.runInContext(read('metadata.js'),context);vm.runInContext(read('player.js'),context);vm.runInContext(read('content.js'),context);
  return {context,state,video,data,holdRead(){holdNext=true;},releaseRead(){releaseRead();},
    importAt(t,revision){emit({videos:{...data.videos,test:{...data.videos.test,t}},importedPositions:{revision,videos:{test:{t,duration:1000}}}});},
    writes:()=>writes,info:()=>JSON.parse(vm.runInContext('JSON.stringify(WAYPOINTS_READ_METADATA())',context)),
    async save(){await vm.runInContext('autosave()',context);},
    serialized(){return JSON.parse(JSON.stringify(vm.runInNewContext('('+vm.runInContext('WAYPOINTS_READ_METADATA.toString()',context)+')()',globals)));},
  };
}
(async()=>{
  const normal=fixture();const info=normal.info();
  assert.equal(info.channelName,'Bloomberg');assert.equal(info.channelUrl,'https://www.youtube.com/@Bloomberg');
  assert.equal(info.title,'Example');assert.equal(info.t,80);assert.equal(info.duration,1000);
  assert.deepEqual(normal.serialized(),info,'injected bookmark function is self-contained');
  assert.equal(vm.runInContext('WAYPOINTS_PLAYER_ACTIONS.bookmark === WAYPOINTS_READ_METADATA',normal.context),true);
  const seek=fixture();
  const absolute=vm.runInContext('WAYPOINTS_PLAYER_ACTIONS.seekTo',seek.context);
  assert.equal(absolute(600).t,600);assert.equal(seek.video.currentTime,600);
  assert.equal(absolute(-100).t,0);assert.equal(absolute(5000).t,1000);
  seek.video.paused=true;assert.equal(absolute(300).paused,true);
  seek.state.ad=true;assert.equal(absolute(400),null);assert.equal(seek.video.currentTime,300);
  seek.state.ad=false;seek.video.duration=Infinity;assert.equal(absolute(10),null);
  seek.video.duration=0;assert.equal(absolute(10),null);
  assert.equal(fixture({ownerId:'previous'}).info().channelName,undefined);
  assert.equal(fixture({owner:false}).info().channelName,undefined,'never fall back to an unrelated recommended channel');
  assert.equal(fixture({href:'https://evil.example/@Fake'}).info().channelName,undefined);
  assert.equal(fixture({href:'javascript:alert(1)'}).info().channelName,undefined);
  assert.equal(fixture({mobile:true,href:'/channel/UCexample'}).info().channelUrl,'https://www.youtube.com/channel/UCexample');
  await normal.save();assert.equal(normal.data.videos.test.channelName,'Bloomberg');assert.equal(normal.data.videos.test.t,80);
  await normal.save();assert.equal(normal.writes(),1,'unchanged time/channel avoids duplicate writes');
  normal.state.channelName='Updated name';await normal.save();
  assert.equal(normal.data.videos.test.channelName,'Updated name','late metadata fills in even at unchanged time');
  normal.state.owner=false;normal.video.currentTime=90;await normal.save();
  assert.equal(normal.data.videos.test.channelName,'Updated name','missing metadata never erases known channel');
  const unbookmarked=fixture({},{});await unbookmarked.save();assert.equal(unbookmarked.writes(),0);
  const ad=fixture({ad:true});await ad.save();assert.equal(ad.writes(),0);
  const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  const imported=fixture();imported.video.paused=true;imported.importAt(796,'first');await drain();
  assert.equal(imported.video.currentTime,796,'paused open player follows import immediately');
  await imported.save();assert.equal(imported.data.videos.test.t,796,'autosave cannot restore the old position');
  imported.video.currentTime=30;imported.importAt(796,'repeat');await drain();
  assert.equal(imported.video.currentTime,796,'identical reimport still restores the player');
  const pending=fixture({ad:true});pending.importAt(796,'ad');await drain();await pending.save();
  assert.equal(pending.data.videos.test.t,796);assert.equal(pending.writes(),0);
  pending.state.ad=false;await pending.save();assert.equal(pending.video.currentTime,796);
  const stale=fixture();await drain();stale.holdRead();const oldSave=stale.save();
  stale.importAt(796,'race');await drain();stale.releaseRead();await oldSave;
  assert.equal(stale.data.videos.test.t,796,'in-flight pre-import read is discarded');
  await stale.save();assert.equal(stale.data.videos.test.t,796);
  console.log('PASS:',flavor,'imported player position adoption, paused player, repeat import, ad deferral, stale autosave guard');
  console.log('PASS:',flavor,'shared/injected channel metadata, owner guards, canonical channel URL, autosave enrichment, late/missing metadata, unbookmarked/ad exclusions');
})().catch(error=>{console.error(error);process.exitCode=1;});
