const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src", "consts", "entries.tsx");
const outPath = path.join(root, "server", "config-schema.json");

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

const reservedLaunchSettingIds = new Set(["PublicPort", "ServerName", "ServerPassword", "AdminPassword"]);
const entries = Object.values(sandbox.module.exports.ENTRIES)
  .filter((entry) => !reservedLaunchSettingIds.has(entry.id))
  .map((entry) => ({
    id: entry.id,
    defaultValue: entry.defaultValue,
    type: entry.type,
  }));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify({ generatedFrom: "src/consts/entries.tsx", entries }, null, 2)}\n`, "utf8");
