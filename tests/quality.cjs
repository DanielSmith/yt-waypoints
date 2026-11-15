// Portable source checks using Node/Python standard libraries only. This is not
// a formatter, semantic linter, type checker, or CSS/HTML validator.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".py",
  ".json",
  ".css",
  ".html",
  ".md",
  ".svg",
]);

function walk(directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : walk(name);
      return entry.isFile() && textExtensions.has(path.extname(name)) ? [name] : [];
    });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw Error(
      result.error?.message ||
        result.stderr ||
        `Syntax check failed: ${command} (${result.signal || result.status})`,
    );
}

function main() {
  const files = ["src", "scripts", "tests", "assets"].flatMap(walk);
  files.push(
    "package.json",
    "package-lock.json",
    ".prettierrc.json",
    "wxt.config.mjs",
    "BUILDING.md",
    "README.md",
    "PRIVACY.md",
    "THIRD-PARTY-NOTICES.md",
    "THEMES.md",
    "CHANGELOG.md",
  );
  const python = [];
  let javascript = 0,
    json = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (text && !text.endsWith("\n")) throw Error(`${file}: missing final newline`);
    text.split("\n").forEach((line, index) => {
      if (/[\t ]\r?$/.test(line)) throw Error(`${file}:${index + 1}: trailing whitespace`);
    });
    const extension = path.extname(file);
    if (extension === ".json") {
      try {
        JSON.parse(text);
      } catch (error) {
        throw Error(`${file}: ${error.message}`);
      }
      json++;
    } else if ([".js", ".cjs", ".mjs"].includes(extension)) {
      run(process.execPath, ["--check", file]);
      javascript++;
    } else if (extension === ".py") python.push(file);
  }
  // Parse without py_compile so read-only checks create no __pycache__ files.
  run("python3", [
    "-c",
    "import ast, pathlib, sys; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8'), filename=p) for p in sys.argv[1:]]",
    ...python,
  ]);
  console.log(
    `PASS: syntax (${javascript} JavaScript, ${python.length} Python), ${json} JSON documents, whitespace/final newlines (${files.length} authored files)`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
