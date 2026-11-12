const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const flavor=process.argv[2]||'firefox';
const extension=path.join(__dirname,'../yt-waypoints-'+flavor);
const read=name=>fs.readFileSync(path.join(extension,name),'utf8');
const source=read('theme.js');
function fixture({dark=false,settings={},pending=false,failed=false}={}) {
  let resolveRead;
  const listeners=[];
  const document={documentElement:{dataset:{}}};
  const media={matches:dark,addEventListener:(event,fn)=>listeners.push(fn)};
  const api={storage:{local:{get:()=>failed?Promise.reject(Error('Storage unavailable')):pending?new Promise(resolve=>resolveRead=resolve):Promise.resolve({settings})}}};
  const context=vm.createContext({document,matchMedia:()=>media,[flavor==='firefox'?'browser':'chrome']:api});
  vm.runInContext(source,context);
  return {document,api:context.WAYPOINTS_THEME,change(dark){media.matches=dark;listeners.forEach(fn=>fn());},
    resolve(value){resolveRead({settings:value});},async settle(){for(let i=0;i<10;i++)await Promise.resolve();}};
}
function luminance(value) {
  const [L,C,H]=value.trim().split(/\s+/).map(Number);
  const a=C*Math.cos(H*Math.PI/180),b=C*Math.sin(H*Math.PI/180);
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  const rgb=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(value=>Math.max(0,Math.min(1,value)));
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
// Palette boundaries apply to all UI styles, not just today's popup.css.
const paintProperty = /^(?:color|background(?:-color|-image)?|accent-color|caret-color|fill|stroke|(?:box|text)-shadow|(?:border|outline|column-rule)(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?(?:-color)?|text-decoration-color|scrollbar-color)$/;
const structuralWords = new Set(['transparent', 'inherit', 'currentcolor', 'none', 'initial',
  'unset', 'revert', 'revert-layer', 'solid', 'dashed', 'dotted', 'double', 'inset', 'outset',
  'groove', 'ridge', 'hidden', 'linear-gradient', 'radial-gradient', 'repeating-linear-gradient',
  'repeating-radial-gradient', 'to', 'top', 'bottom', 'left', 'right', 'circle', 'ellipse',
  'at', 'center', 'closest-side', 'farthest-side', 'closest-corner', 'farthest-corner']);
function checkStyleBoundary(css, filename) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, property, value] of css.matchAll(/(?:^|[;{}])\s*([-a-z]+)\s*:\s*([^;{}]+)/gi)) {
    assert.ok(!property.startsWith('--color-') && property !== 'color-scheme', `${filename}: palette definitions belong in themes/`);
    if (!paintProperty.test(property)) continue;
    const remaining = value.replace(/var\(\s*(--[a-z-]+)\s*\)/gi, (_, token) => {
      assert.ok(token.startsWith('--color-') || token === '--progress', `${filename}: ${property} uses a non-palette variable ${token}`);
      return '';
    });
    const words = remaining.match(/\b[a-z][a-z-]*\b/gi) || [];
    assert.ok(words.every(word => structuralWords.has(word.toLowerCase())),
      `${filename}: ${property}: ${value.trim()} must use theme tokens, not literal colors`);
    assert.ok(!/#[0-9a-f]+/i.test(remaining), `${filename}: literal hex color`);
  }
}
function checkUiFiles(directory = extension) {
  const styles = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'themes' && item.name !== 'icons') styles.push(...checkUiFiles(filename));
    } else if (item.name.endsWith('.css')) {
      const css = fs.readFileSync(filename, 'utf8');
      checkStyleBoundary(css, filename);
      styles.push(css);
    } else if (item.name.endsWith('.html')) {
      const html = fs.readFileSync(filename, 'utf8');
      for (const [, , css] of html.matchAll(/style\s*=\s*(["'])(.*?)\1/gi)) {
        checkStyleBoundary(css, filename);
        styles.push(css);
      }
      for (const [, css] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        checkStyleBoundary(css, filename);
        styles.push(css);
      }
      assert.ok(!/\s(?:color|bgcolor|fill|stroke)\s*=/i.test(html), `${filename}: presentation colors belong in themed CSS`);
    } else if (item.name.endsWith('.js')) {
      const js = fs.readFileSync(filename, 'utf8');
      assert.ok(!/\.style\.(?:color|background(?:Color|Image)?|border(?:Color)?|outline(?:Color)?|accentColor|fill|stroke|boxShadow|cssText)\s*=/i.test(js), `${filename}: inline paint overrides bypass themes`);
      assert.ok(!/\.style\.setProperty\(\s*["'](?:--color-[a-z-]+|color|background(?:-color)?|border(?:-color)?|fill|stroke|accent-color)["']/i.test(js), `${filename}: palette overrides belong in themes/`);
      assert.ok(!/\.setAttribute\(\s*["'](?:style|color|bgcolor|fill|stroke)["']/i.test(js), `${filename}: inline styling needs the CSS theme contract`);
    }
  }
  return styles;
}
(async()=>{
  const system=fixture({dark:true});assert.equal(system.document.documentElement.dataset.theme,'dark');
  await system.settle();system.change(false);assert.equal(system.document.documentElement.dataset.theme,'light');
  system.api.apply('dark');system.change(false);assert.equal(system.document.documentElement.dataset.theme,'dark');
  system.api.apply('system');assert.equal(system.document.documentElement.dataset.theme,'light');
  const stored=fixture({dark:false,settings:{theme:'dark'}});await stored.settle();assert.equal(stored.document.documentElement.dataset.theme,'dark');
  const race=fixture({pending:true,dark:false});race.api.apply('light');race.resolve({theme:'dark'});await race.settle();
  assert.equal(race.document.documentElement.dataset.theme,'light','late initial storage read cannot undo an explicit selection');
  const failure=fixture({failed:true,dark:true});await failure.settle();assert.equal(failure.document.documentElement.dataset.theme,'dark');
  assert.equal(system.api.normalize('bad'),'system');
  const components = checkUiFiles().join('\n');
  // Prove the guard catches named/modern colors and fallback/alias bypasses.
  for (const css of ['.trash { background: lightcoral; }', '.row { color: #abc; }',
    '.row { color: color(display-p3 1 0 0); }', '.row { color: var(--color-text, red); }',
    ':root { --color-trash-surface: pink; }', '.row { background: var(--local-pink); }']) {
    assert.throws(() => checkStyleBoundary(css, 'regression fixture'));
  }
  checkStyleBoundary('.row { color: inherit; background: transparent; border: 1px solid var(--color-border); }', 'valid fixture');
  const roles=[...new Set([...components.matchAll(/var\((--color-[a-z-]+)\)/g)].map(match=>match[1]))].sort();
  for(const theme of ['light','dark']) {
    const css=read(`themes/${theme}.css`);
    const colors=Object.fromEntries([...css.matchAll(/(--color-[a-z-]+):\s*oklch\(([^)]+)\)/g)].map(match=>[match[1],match[2]]));
    assert.deepEqual(Object.keys(colors).sort(),roles,`${theme} must supply every semantic role without orphaned tokens`);
    assert.ok(css.includes(`color-scheme: ${theme}`));
    function contrast(a,b,min) {
      const values=[luminance(colors[a]),luminance(colors[b])].sort((a,b)=>b-a);
      const ratio=(values[0]+.05)/(values[1]+.05);
      assert.ok(ratio>=min,`${theme}: ${a} / ${b} contrast ${ratio.toFixed(2)} < ${min}`);
    }
    for(const surface of ['--color-surface','--color-surface-raised','--color-surface-hover','--color-selected','--color-trash-surface','--color-trash-hover']) {
      contrast('--color-text',surface,4.5);contrast('--color-text-muted',surface,4.5);
    }
    contrast('--color-on-accent','--color-accent',4.5);
    contrast('--color-on-positive','--color-positive',4.5);
    contrast('--color-focus','--color-surface',3);
    contrast('--color-control-border','--color-surface',3);
    for (const surface of ['--color-surface', '--color-surface-hover', '--color-selected']) contrast('--color-current-border',surface,3);
    for (const surface of ['--color-trash-surface', '--color-trash-hover', '--color-selected']) contrast('--color-trash-border',surface,3);
    contrast('--color-danger','--color-surface',4.5);
  }
  console.log('PASS:',flavor,'theme startup/system/override/storage-race behavior, all UI styles/HTML/JS palette boundaries, complete theme contract, text/button/focus/control contrast');
})().catch(error=>{console.error(error);process.exitCode=1;});
