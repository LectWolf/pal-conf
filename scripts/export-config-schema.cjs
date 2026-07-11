const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "server", "config-schema.json");

function loadTsModule(relativePath) {
  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  });
  const sandbox = {
    exports: {},
    module: { exports: {} },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });
  return sandbox.module.exports;
}

const entriesModule = loadTsModule(path.join("src", "consts", "entries.tsx"));
const settingsModule = loadTsModule(path.join("src", "consts", "settings.tsx"));
const worldOptionModule = loadTsModule(path.join("src", "consts", "worldoption.tsx"));

const reservedLaunchSettingIds = new Set([
  "PublicPort",
  "PublicIP",
  "RCONEnabled",
  "RCONPort",
  "RESTAPIEnabled",
  "RESTAPIPort",
]);
const entries = Object.values(entriesModule.ENTRIES)
  .filter((entry) => !reservedLaunchSettingIds.has(entry.id))
  .map((entry) => ({
    id: entry.id,
    defaultValue: entry.defaultValue,
    type: entry.type,
  }));
const worldOptionKeys = Object.keys(worldOptionModule.DEFAULT_WORLDOPTION);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedFrom: "src/consts/entries.tsx",
      entries,
      entryIdToEnumName: settingsModule.EntryIdToEnumName,
      worldOptionKeys,
      defaultWorldOptionSav: worldOptionModule.DEFAULT_WORLDOPTION_SAV,
    },
    null,
    2
  )}\n`,
  "utf8"
);
