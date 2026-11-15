const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const setupFixture = require("./setup.cjs");
const createHelpers = require("./helpers.cjs");
const features = require("./cases.cjs");
const preparePreview = require("./preview.cjs");

function writeFixture({ extension, temporary, options }) {
  const setup = `<base href="${pathToFileURL(extension + path.sep).href}"><script>(${setupFixture.toString()})();</script>`;
  const runs = features
    .map(
      ({ name, run }) => `
    markStage(${JSON.stringify(name)});
    const ${name}Start = context.cases.length;
    await (${run.toString()})(context);
    completed.push({ name: stage, cases: context.cases.length - ${name}Start });
  `,
    )
    .join("\n");
  const driver = `window.addEventListener('load', async () => {
    const report = document.createElement('pre');
    report.id = 'keyboard-result'; report.hidden = true; document.body.append(report);
    const context = (${createHelpers.toString()})();
    const completed = [];
    let stage;
    function markStage(name) {
      stage = name;
      report.textContent = encodeURIComponent(JSON.stringify({ pass: false, stage,
        completed, error: 'DOM run did not complete before the browser deadline' }));
    }
    markStage('initialization');
    try {
      await context.waitFor(() => !document.getElementById('search').disabled, 'Popup initialization timed out');
      context.check(innerWidth >= 360 && innerHeight >= 520, 'Fixture viewport must fit the complete 360 × 520 popup frame');
      ${runs}
      markStage('preview');
      await (${preparePreview.toString()})(${JSON.stringify(options)}, context);
      report.textContent = encodeURIComponent(JSON.stringify({ pass: true, cases: context.cases,
        features: completed, engine: 'Chrome', adapter: ${JSON.stringify(options.flavor)},
        preview: ${JSON.stringify(options.preview)}, viewport: { width: innerWidth, height: innerHeight } }));
    } catch (error) {
      report.textContent = encodeURIComponent(JSON.stringify({ pass: false, stage,
        completed, error: error.stack || error.message }));
    }
  });`;
  const moduleFixture = path.join(temporary, "popup-fixture.mjs");
  const html = fs
    .readFileSync(path.join(extension, "popup.html"), "utf8")
    .replace(/\b(src|href)="\/(?!\/)/g, '$1="')
    .replace("<head>", "<head>" + setup)
    .replace(
      /(<script\b[^>]*type="module"[^>]*src=")([^"]+)("[^>]*><\/script>)/,
      (_, before, source, after) => {
        // Production module bytes remain intact. Only the disposable copy gets
        // injected helpers/cases in its scope, as the original fixture did.
        fs.writeFileSync(
          moduleFixture,
          fs.readFileSync(path.join(extension, source), "utf8") + "\n" + driver,
        );
        return before + pathToFileURL(moduleFixture).href + after;
      },
    );
  assert.ok(fs.existsSync(moduleFixture), "Expected a WXT popup module script");
  const fixturePath = path.join(temporary, "fixture.html");
  fs.writeFileSync(fixturePath, html);
  return fixturePath;
}

module.exports = { writeFixture };
