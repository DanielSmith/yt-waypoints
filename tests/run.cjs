// Standard-library test orchestration; no shell expansion or parallel builds.
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

const suites = {
  quality: { file: "quality.cjs" },
  "popup-refresh": { file: "popup-refresh.cjs" },
  "youtube-values": { file: "youtube-values.cjs" },
  "alap-data": { file: "alap-data.cjs" },
  "alap-query": { file: "alap-query.cjs" },
  "alap-refiners": { file: "alap-refiners.cjs" },
  "alap-sorting": { file: "alap-sorting.cjs" },
  "alap-transfer": { file: "alap-transfer.cjs" },
  "popup-ui": { file: "popup-ui.cjs" },
  "popup-input": { file: "popup-input.cjs" },
  popup: { file: "popup.cjs", flavored: true },
  theme: { file: "theme.cjs", flavored: true },
  "theme-data": { file: "theme-data.cjs" },
  "theme-readers": { file: "theme-readers.cjs" },
  "theme-convert": { file: "theme-convert.cjs" },
  "theme-library": { file: "theme-library.cjs" },
  "theme-import": { file: "theme-import.cjs" },
  "theme-application": { file: "theme-application.cjs", flavored: true },
  player: { file: "player.cjs", flavored: true },
  "player-results": { file: "player-results.cjs", flavored: true },
  transcript: { file: "transcript.cjs", flavored: true },
  "transcript-reader": { file: "transcript-reader.cjs", flavored: true },
  storage: { file: "storage.cjs", flavored: true },
  metadata: { file: "metadata.cjs", flavored: true },
  transfer: { file: "transfer.cjs", flavored: true },
  "content-lifecycle": { file: "content-lifecycle.cjs", flavored: true },
  "marker-data": { file: "marker-data.cjs", flavored: true },
  chapters: { file: "chapters.cjs", flavored: true },
  packages: { file: "build.py", python: true },
  "keyboard-browser": { file: "keyboard-browser.cjs", flavored: true, optional: true },
};

function parseOptions(args) {
  const selected = [],
    flavors = [];
  let skipBuild = false,
    list = false,
    help = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--skip-build") skipBuild = true;
    else if (arg === "--list") list = true;
    else if (arg === "--help") help = true;
    else if (arg === "--suite" || arg === "--flavor") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw Error(`Missing value for ${arg}`);
      if (arg === "--suite") {
        if (!Object.hasOwn(suites, value)) throw Error(`Unknown suite: ${value}. Use --list.`);
        selected.push(value);
      } else {
        if (!["firefox", "chrome"].includes(value)) throw Error(`Unknown flavor: ${value}`);
        flavors.push(value);
      }
    } else throw Error(`Unknown option: ${arg}. Use --help.`);
  }
  return {
    selected: selected.length
      ? [...new Set(selected)]
      : Object.keys(suites).filter((name) => !suites[name].optional),
    flavors: flavors.length ? [...new Set(flavors)] : ["firefox", "chrome"],
    skipBuild,
    list,
    help,
  };
}

function createPlan({ selected, flavors, skipBuild }) {
  const plan = [];
  // Packages verify both outputs. Always build both before adapter-dependent
  // tests, even when a focused selection runs only one adapter's cases.
  if (!skipBuild && selected.some((name) => suites[name].flavored || suites[name].python))
    plan.push({ name: "build", command: "python3", args: ["scripts/build.py"] });
  for (const name of selected) {
    const suite = suites[name];
    for (const flavor of suite.flavored ? flavors : [null])
      plan.push({
        name: flavor ? `${name}/${flavor}` : name,
        command: suite.python ? "python3" : process.execPath,
        args: [`tests/${suite.file}`, ...(flavor ? [flavor] : [])],
      });
  }
  return plan;
}

function runPlan(plan, spawn = spawnSync) {
  for (const step of plan) {
    console.log(`RUN: ${step.name}`);
    const result = spawn(step.command, step.args, { cwd: root, stdio: "inherit" });
    if (result.error || result.status !== 0) {
      console.error(
        `FAIL: ${step.name}: ${result.error?.message || result.signal || `exit ${result.status}`}`,
      );
      return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    }
  }
  return 0;
}

function main(args) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(
      "Usage: node tests/run.cjs [--suite NAME] [--flavor firefox|chrome] [--skip-build]\nRepeat --suite/--flavor to select several. Default: full build, all non-DOM suites, both adapters and package reproducibility.\n--list lists suites. --skip-build requires fresh existing packages.",
    );
    return 0;
  }
  if (options.list) {
    for (const [name, suite] of Object.entries(suites))
      console.log(
        `${name}${suite.flavored ? " (adapter-specific)" : ""}${suite.optional ? " (opt-in headless Chrome)" : ""}`,
      );
    return 0;
  }
  return runPlan(createPlan(options));
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { suites, parseOptions, createPlan, runPlan };
