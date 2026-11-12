const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const flavor = process.argv[2] || 'firefox';
const source = fs.readFileSync(path.join(__dirname, '../yt-waypoints-' + flavor, 'player.js'), 'utf8');
const actions = vm.runInNewContext(source + '\nWAYPOINTS_PLAYER_ACTIONS', {WAYPOINTS_READ_METADATA:()=>{}});

// Re-serialize just as scripting.executeScript does, with no shared closures.
function injected(name, globals, args) {
  return vm.runInNewContext(`(${actions[name].toString()})(...args)`, {URLSearchParams,...globals,args});
}

(async()=>{
  for (const fps of [24, 30, 60]) {
    const video = {currentTime:100, duration:1000, paused:true, playbackRate:1,
      pauseCalls:0,pause(){this.pauseCalls++;this.paused=true;assert.ok(Math.abs(this.currentTime-100)<1e-9,'pause before seeking');}};
    const player = {
      getVideoStats:()=>({fmt:'399'}),
      getPlayerResponse:()=>({streamingData:{adaptiveFormats:[{itag:399,fps}]}}),
      getAvailablePlaybackRates:()=>[0.25,0.5,0.75,1,1.25,1.5,1.75,2],
      setPlaybackRate:rate=>{video.playbackRate=rate;},
    };
    let ad = false;
    const globals = {
      location:{search:'?v=aaaaaaaaaaa'},
      document:{getElementById:()=>flavor==='firefox'?{wrappedJSObject:player}:player,
        querySelector:selector=>selector.includes('video')&&!selector.includes('ad-showing')?video:(ad && selector.includes('ad-showing')?{}:null)},
    };
    const run=(operation,direction=1,id='aaaaaaaaaaa')=>injected('playback',globals,[operation,direction,id]);
    assert.equal(run('frame').fps,fps);
    assert.ok(Math.abs(video.currentTime-(100+1/fps))<1e-9);
    run('frame',-1);assert.ok(Math.abs(video.currentTime-100)<1e-9);
    assert.equal(video.pauseCalls,0,'already-paused stepping does not pause again');
    video.paused=false;assert.equal(run('frame').fps,fps);
    assert.equal(video.paused,true);assert.equal(video.pauseCalls,1);
    assert.ok(Math.abs(video.currentTime-(100+1/fps))<1e-9,'playing video pauses and steps forward');
    video.currentTime=100;video.paused=false;run('frame',-1);
    assert.equal(video.paused,true);assert.equal(video.pauseCalls,2);
    assert.ok(Math.abs(video.currentTime-(100-1/fps))<1e-9,'playing video pauses and steps backward');
    video.paused=false;
    run('rate');assert.equal(video.playbackRate,1.25);assert.equal(video.paused,false);
    run('rate',-1);assert.equal(video.playbackRate,1);
    video.playbackRate=2;run('rate');assert.equal(video.playbackRate,2);
    video.playbackRate=.25;run('rate',-1);assert.equal(video.playbackRate,.25);
    video.paused=true;video.currentTime=0;run('frame',-1);assert.equal(video.currentTime,0);
    video.currentTime=1000;run('frame');assert.equal(video.currentTime,1000);
    assert.match(run('frame',1,'other').error,/changed videos/);
    ad=true;assert.match(run('frame').error,/ad to finish/);assert.match(run('rate').error,/ad to finish/);ad=false;
    video.currentTime=100;video.paused=false;
    player.getVideoStats=()=>({});assert.match(run('frame').error,/frame rate/);
    assert.equal(video.paused,false,'failed frame-rate lookup does not interrupt playback');
    video.videoWidth=1920;video.videoHeight=1080;
    player.getPlayerResponse=()=>({streamingData:{adaptiveFormats:{0:{itag:399,fps,width:1920,height:1080},length:1,find(){throw Error('Cross-world callback denied');}}}});
    assert.equal(run('frame').fps,fps,'resolution fallback does not need private array callbacks');
    player.getVideoStats=()=>JSON.stringify({fps});
    player.getPlayerResponse=()=>{throw Error('Response unavailable');};
    assert.equal(run('frame').fps,fps,'a throwing response getter cannot break available stats');
    player.getVideoStats=()=>{throw Error('Stats unavailable');};
    player.getAvailablePlaybackRates=()=>{throw Error('Rate API unavailable');};
    player.setPlaybackRate=()=>{throw Error('Private setter unavailable');};
    video.playbackRate=1;assert.equal(run('rate').rate,1.25,'HTML video rate works without private APIs');
    assert.equal(run('rate',-1).rate,1);
    globals.document.getElementById=()=>null;
    assert.equal(run('rate').rate,1.25,'player wrapper is not required for speed controls');
    assert.match(run('frame').error,/frame rate/,'never guess a frame rate');
    globals.document.querySelector=()=>null;
    assert.match(run('frame').error,/No video player/);
  }

  // Serialized seek/toggle functions must bind the actual URL and visible video
  // before mutating playback, not just attach the requested ID to a response.
  {
    const id = 'aaaaaaaaaaa';
    let visibleId = id;
    let ad = false;
    const video = { currentTime: 100, duration: 1000, paused: false,
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
    const globals = { location: { search: '?v=' + id }, document: {
      querySelector(selector) {
        if (selector === 'video') return video;
        if (selector.includes('ad-showing')) return ad ? {} : null;
        if (selector.startsWith('ytd-watch-flexy')) return { getAttribute: () => visibleId };
        return null;
      },
    } };
    const run = (name, args) => injected(name, globals, args);
    assert.equal(run('seek', [10, id]).id, id); assert.equal(video.currentTime, 110);
    assert.equal(run('seekTo', [300, id]).t, 300);
    assert.equal(run('toggle', [id]).paused, true);
    assert.equal(run('toggle', [id]).paused, false);
    for (const [name, args] of [['seek', [10, 'bbbbbbbbbbb']], ['seekTo', [500, 'bbbbbbbbbbb']], ['toggle', ['bbbbbbbbbbb']]]) {
      const before = { t: video.currentTime, paused: video.paused };
      assert.match(run(name, args).error, /changed videos/);
      assert.deepEqual({ t: video.currentTime, paused: video.paused }, before);
    }
    visibleId = 'bbbbbbbbbbb';
    for (const [name, args] of [['seek', [10, id]], ['seekTo', [500, id]], ['toggle', [id]]]) {
      assert.match(run(name, args).error, /still changing/);
      assert.equal(video.currentTime, 300); assert.equal(video.paused, false);
    }
    visibleId = id; ad = true;
    assert.equal(run('toggle', [id]), null);
    assert.equal(video.paused, false);
    ad = false;
    assert.equal(run('seek', [NaN, id]), null);
    assert.equal(run('seekTo', [Infinity, id]), null);
  }
  console.log('PASS:', flavor, 'serialized seek/toggle identities, SPA guards, ad exclusions, and invalid arguments');

})().catch(error=>{console.error(error);process.exitCode=1;});
