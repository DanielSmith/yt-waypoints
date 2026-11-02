const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const flavor=process.argv[2]||'firefox';
const context=vm.createContext({URL});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../yt-waypoints-'+flavor,'transfer.js'),'utf8'),context);
const transfer=context.WAYPOINTS_TRANSFER;
const plain=value=>JSON.parse(JSON.stringify(value));
const a='aaaaaaaaaaa',b='bbbbbbbbbbb',c='ccccccccccc',d='ddddddddddd';
const video=(id,t,updated,other={})=>({id,title:'Video '+id,t,duration:1000,updated,...other});
const existing={[a]:video(a,80,200,{channelName:'Known channel',channelUrl:'https://www.youtube.com/@Known'}),[b]:video(b,20,50),[d]:video(d,90,999)};
const incoming={[a]:video(a,10,100),[b]:video(b,10,150),[c]:video(c,35,75)};
const exported=transfer.stringify(incoming);
assert.equal(JSON.parse(exported).format,'yt-waypoints');
assert.deepEqual(plain(transfer.parse(exported)),incoming);
assert.deepEqual(plain(transfer.parse(JSON.stringify(incoming))),incoming,'legacy videos map works');
assert.deepEqual(plain(transfer.parse(JSON.stringify({videos:incoming,settings:{autoBookmark:false}}))),incoming,'only videos from storage snapshot are used');
assert.deepEqual(plain(transfer.parse(JSON.stringify(Object.values(incoming)))),incoming);
const result=transfer.merge(existing,transfer.parse(exported));
assert.deepEqual(plain(result.counts),{added:1,updated:2,kept:0});
assert.equal(result.videos[a].t,10);assert.equal(result.videos[b].t,10,'manual import chooses the pasted point');
assert.deepEqual(plain(result.videos[d]),existing[d],'unrelated local bookmark remains');
assert.deepEqual(plain(transfer.merge(result.videos,transfer.parse(exported)).counts),{added:0,updated:0,kept:3});
const tied=transfer.merge(existing,{[a]:video(a,999,200)});assert.equal(tied.videos[a].t,999);
const newer=transfer.merge(existing,{[a]:video(a,5,300)});assert.equal(newer.videos[a].channelName,'Known channel');
const fill=transfer.merge({[a]:video(a,77,500)},{[a]:video(a,12,100,{channelName:'Channel'})});
assert.equal(fill.videos[a].t,12);assert.equal(fill.videos[a].updated,100);assert.equal(fill.videos[a].channelName,'Channel');
const duplicates=transfer.parse(JSON.stringify([video(a,10,20),video(a,5,30),video(a,999,10)]));assert.equal(duplicates[a].t,5);
const clamped=transfer.parse(JSON.stringify({[a]:video(a,2000,1)}));assert.equal(clamped[a].t,1000);
const noTimestamp=transfer.parse(JSON.stringify({[a]:{id:a,t:2}}));assert.equal(noTimestamp[a].updated,0);
assert.equal(transfer.merge(existing,noTimestamp).videos[a].t,2);
const stripped=transfer.parse(JSON.stringify({[a]:video(a,2,1,{url:'javascript:alert(1)',thumbnail:'https://evil.example/image',channelUrl:'https://m.youtube.com/@Creator?tracking=drop#section'})}));
assert.equal(stripped[a].url,undefined);assert.equal(stripped[a].thumbnail,undefined);
assert.equal(stripped[a].channelUrl,'https://www.youtube.com/@Creator');
for(const invalid of [
  '{', 'null','42','"text"',JSON.stringify({settings:{}}),JSON.stringify({videos:null}),
  JSON.stringify({format:'other',version:1,videos:incoming}),JSON.stringify({format:'yt-waypoints',version:2,videos:incoming}),
  JSON.stringify({[a]:video(b,1,1)}),JSON.stringify({short:video('short',1,1)}),
  JSON.stringify({[a]:video(a,-1,1)}),JSON.stringify({[a]:video(a,'12',1)}),
  JSON.stringify({[a]:video(a,1,-2)}),JSON.stringify({[a]:video(a,1,1,{title:{}})}),
  JSON.stringify({[a]:video(a,1,1,{duration:-5})}),JSON.stringify({[a]:video(a,1,1,{channelName:[]})}),
  JSON.stringify({[a]:video(a,1,1,{channelUrl:'javascript:alert(1)'})}),
  JSON.stringify({[a]:video(a,1,1,{channelUrl:'https://www.youtube.com.evil.example/@Creator'})}),
  JSON.stringify({[a]:video(a,1,1,{channelUrl:'https://someone@www.youtube.com/@Creator'})}),
  JSON.stringify({[a]:video(a,1,1,{channelUrl:'https://www.youtube.com/watch?v='+a})}),
  JSON.stringify([video(a,1,1),{id:b,t:-1}]), ' '.repeat(5_000_001),
]) assert.throws(()=>transfer.parse(invalid));
const special=transfer.parse('{"videos":{"constructor":{"id":"constructor","t":4,"updated":1,"__proto__":{"polluted":true}}}}');
assert.equal(special.constructor.id,'constructor');assert.equal(special.constructor.polluted,undefined);
assert.equal(Object.getPrototypeOf(special),null);
assert.equal(({}).polluted,undefined);
assert.deepEqual(plain(transfer.merge(existing,transfer.parse('{}')).counts),{added:0,updated:0,kept:0});
// Unknown fields are dropped at every boundary, including a direct merge call.
const allowed=new Set(['id','title','t','duration','updated','channelName','channelUrl']);
const noisy=video(c,40,100,{url:'javascript:alert(1)',thumbnail:'https://evil.example/image',settings:{autoBookmark:true},permissions:['history'],html:'<script>bad()</script>',prototype:{polluted:true},constructor:{polluted:true}});
Object.defineProperty(noisy,'ignoredGetter',{enumerable:true,get(){throw Error('Unknown field was accessed');}});
const direct=transfer.merge({}, {[c]:noisy});
assert.ok(Object.keys(direct.videos[c]).every(key=>allowed.has(key)));
assert.equal(direct.videos[c].url,undefined);assert.equal(direct.videos[c].settings,undefined);
const cleaned=transfer.merge({[c]:{...video(c,20,200),custom:{secret:true}}},{[c]:video(c,99,100)});
assert.equal(cleaned.videos[c].t,99);assert.equal(cleaned.videos[c].custom,undefined);
const exportClean=JSON.parse(transfer.stringify({[c]:{...video(c,1,1),settings:{secret:true},arbitraryUrl:'https://evil.example'}}));
assert.ok(Object.keys(exportClean.videos[c]).every(key=>allowed.has(key)));
const envelope=transfer.parse(JSON.stringify({format:'yt-waypoints',version:1,videos:{[c]:video(c,1,1,{extra:{deep:'ignored'}})},settings:{danger:true},permissions:['history'],script:'bad()'}));
assert.deepEqual(plain(envelope),{[c]:video(c,1,1)});
const cleanText=transfer.parse(JSON.stringify({[a]:video(a,1,1,{title:'  hello\u0000\tworld\n ',channelName:' News\u007f Channel '})}));
assert.equal(cleanText[a].title,'hello world');assert.equal(cleanText[a].channelName,'News Channel');
const literal=transfer.parse(JSON.stringify({[a]:video(a,1,1,{title:'<script>alert(1)</script>'})}));
assert.equal(literal[a].title,'<script>alert(1)</script>','markup stays inert text, not executable HTML');
for(const malformed of [
  video(a,0.5,1), video(a,1,1.5), video(a,1,1,{duration:1.5}),
  video(a,1,1,{id:null}),video(a,1,1,{t:true}),video(a,1,1,{t:null}),
  video(a,1,1,{updated:Number.MAX_SAFE_INTEGER+1}),
  video(a,1,1,{title:'x'.repeat(1001)}),video(a,1,1,{channelName:'x'.repeat(201)}),
  video(a,1,1,{channelUrl:'https://www.youtube.com/@'+'x'.repeat(2048)}),
  ...['/@Foo%2FBar','/@Foo%5CBar','/@Foo%00','/@Foo%20Bar','/@Foo%FF','/@Foo%3Fbar'].map(path=>video(a,1,1,{channelUrl:'https://www.youtube.com'+path})),
  video(a,1,1,{channelUrl:'https://www.you\ttube.com/@Foo'}),
]) assert.throws(()=>transfer.parse(JSON.stringify({[a]:malformed})));
assert.throws(()=>transfer.parse('{"aaaaaaaaaaa":{"id":"aaaaaaaaaaa","t":1e309}}'));
assert.throws(()=>transfer.parse({videos:{}}));
assert.throws(()=>transfer.merge({}, {[a]:video(a,-1,1)}),'merge itself validates known fields');
console.log('PASS:',flavor,'strict field allowlists in parse/merge/export; own fields only; integer/string/URL limits; unknown fields/getters ignored; inert text; no prototype/HTML/URL injection');
console.log('PASS:',flavor,'JSON round trip, map/array/storage snapshots, explicit pasted-source merge, metadata preservation, no deletions/settings transfer, all-record validation, safe IDs/URLs/fields, duplicate/empty/size handling');

const copiedPoint=transfer.merge({[a]:video(a,85,1793659999999)},{[a]:video(a,796,1793656321686)});
assert.equal(copiedPoint.videos[a].t,796,'a Chrome autosave clock cannot veto the 796-second Firefox point');
assert.equal(copiedPoint.counts.updated,1);
