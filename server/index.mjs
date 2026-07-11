import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pako from "pako";
import * as uesave from "../src/lib/uesave/uesave_wasm_bg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const envText = fs.readFileSync(filePath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(root, ".env"));

const distDir = path.join(root, "dist");
const publicDir = path.join(root, "public");
const schemaPath = path.join(__dirname, "config-schema.json");
const dbPath = process.env.PAL_CONF_DB_PATH ?? path.join(root, "data", "configs.sqlite");
const port = Number(process.env.PORT ?? process.env.HTTP_PORT_PREVIEW ?? 4173);
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const schemaEntries = schema.entries;
const schemaById = new Map(schemaEntries.map((entry) => [entry.id, entry]));
const entryIdToEnumName = schema.entryIdToEnumName ?? {};
const alwaysWriteWorldOptionIds = new Set(["AdminPassword"]);

const wasmBytes = fs.readFileSync(path.join(root, "src", "lib", "uesave", "uesave_wasm_bg.wasm"));
const wasm = await WebAssembly.instantiate(wasmBytes, { "./uesave_wasm_bg.js": uesave });
uesave.__wbg_set_wasm(wasm.instance.exports);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    code TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    settings_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
const insertConfig = db.prepare("INSERT INTO configs (code, settings_json, settings_hash) VALUES (?, ?, ?)");
const selectConfig = db.prepare("SELECT code, settings_json FROM configs WHERE code = ?");
const selectConfigByHash = db.prepare("SELECT code, settings_json FROM configs WHERE settings_hash = ?");

function normalizeCode(code) {
  const compact = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : String(code ?? "").toUpperCase().trim();
}

function generateCode() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += codeAlphabet[crypto.randomInt(codeAlphabet.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 格式无效"));
      }
    });
    req.on("error", reject);
  });
}

function getDefaultSettings() {
  return Object.fromEntries(schemaEntries.map((entry) => [entry.id, entry.defaultValue]));
}

function isSameEntryValue(entry, value, otherValue = entry.defaultValue) {
  if (entry.type === "integer" || entry.type === "float") {
    return Number(value) === Number(otherValue);
  }
  return String(value) === String(otherValue);
}

function sanitizeOverrides(settings) {
  const overrides = {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return overrides;
  }
  for (const [id, rawValue] of Object.entries(settings)) {
    const entry = schemaById.get(id);
    if (!entry || rawValue === null || typeof rawValue === "undefined") {
      continue;
    }
    const value = String(rawValue);
    if (!isSameEntryValue(entry, value)) {
      overrides[id] = value;
    }
  }
  return overrides;
}

function canonicalizeOverrides(overrides) {
  return Object.fromEntries(Object.entries(sanitizeOverrides(overrides)).sort(([left], [right]) => left.localeCompare(right)));
}

function stringifyCanonicalOverrides(overrides) {
  return JSON.stringify(canonicalizeOverrides(overrides));
}

function hashOverrides(overrides) {
  return crypto.createHash("sha256").update(stringifyCanonicalOverrides(overrides)).digest("hex");
}

function mergeSettings(overrides) {
  return { ...getDefaultSettings(), ...sanitizeOverrides(overrides) };
}

function formatIniValue(entry, value) {
  switch (entry.type) {
    case "array":
      return `${entry.id}=(${value})`;
    case "float":
      return `${entry.id}=${Number(value).toFixed(6)}`;
    case "string":
      return `${entry.id}=${JSON.stringify(value)}`;
    default:
      return `${entry.id}=${value}`;
  }
}

function buildPalWorldSettingsIni(settings) {
  const values = schemaEntries.map((entry) => formatIniValue(entry, settings[entry.id] ?? entry.defaultValue));
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${values.join(",")})\n`;
}

function quoteShellValue(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function buildStartupEnv(settings) {
  return [
    `export ADMIN_PASSWORD=${quoteShellValue(settings.AdminPassword ?? "")}`,
    `export SERVER_PASSWORD=${quoteShellValue(settings.ServerPassword ?? "")}`,
    "",
  ].join("\n");
}

function buildWorldOptionJson(settings) {
  const result = {};
  for (const entry of schemaEntries) {
    const value = settings[entry.id] ?? entry.defaultValue;
    const defaultValue = entry.defaultValue;
    const enumType = entryIdToEnumName[entry.id];

    if (!alwaysWriteWorldOptionIds.has(entry.id) && (entry.type === "integer" || entry.type === "float") && Number(value) === Number(defaultValue)) {
      continue;
    }
    if (!alwaysWriteWorldOptionIds.has(entry.id) && entry.type !== "integer" && entry.type !== "float" && String(value) === String(defaultValue)) {
      continue;
    }

    if (entry.type === "select" && enumType) {
      result[entry.id] = {
        Enum: {
          value: `${enumType}::${value}`,
          enum_type: enumType,
        },
      };
    } else if (entry.type === "array" && enumType) {
      const enumValues = String(value).trim() === "" ? [] : String(value).split(",").map((item) => `${enumType}::${item}`);
      result[entry.id] = {
        Array: {
          array_type: "EnumProperty",
          value: {
            Base: {
              Enum: enumValues,
            },
          },
        },
      };
    } else if (entry.type === "boolean") {
      result[entry.id] = {
        Bool: {
          value: value === "True",
        },
      };
    } else if (entry.type === "integer") {
      result[entry.id] = {
        Int: {
          value: Number(value),
        },
      };
    } else if (entry.type === "float") {
      result[entry.id] = {
        Float: {
          value: Number(value),
        },
      };
    } else if (entry.type === "string") {
      result[entry.id] = {
        Str: {
          value,
        },
      };
    }
  }
  return result;
}

function buildWorldOptionSav(settings) {
  const save = JSON.parse(JSON.stringify(schema.defaultWorldOptionSav));
  save.gvas.root.properties.OptionWorldData.Struct.value.Struct.Settings.Struct.value.Struct = buildWorldOptionJson(settings);

  let serialized = uesave.serialize(JSON.stringify(save.gvas));
  const lenDecompressed = serialized.length;
  const leadingByte = (save.magic & 0xff000000) >> 24;
  if (leadingByte === 0x32) {
    serialized = pako.deflate(serialized);
    serialized = pako.deflate(serialized);
  } else if (leadingByte === 0x31) {
    serialized = pako.deflate(serialized);
  }

  const lenCompressed = serialized.length;
  const buffer = Buffer.alloc(4 + 4 + 4 + lenCompressed);
  buffer.writeInt32LE(lenDecompressed, 0);
  buffer.writeInt32LE(lenCompressed, 4);
  buffer.writeInt32LE(save.magic, 8);
  buffer.set(serialized, 12);
  return buffer;
}

function getConfig(code) {
  const row = selectConfig.get(code);
  if (!row) {
    return null;
  }
  return {
    code: row.code,
    overrides: JSON.parse(row.settings_json),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendBuffer(res, status, body, contentType = "application/octet-stream") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
  }[ext] ?? "application/octet-stream";
}

function sendFile(res, baseDir, requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(baseDir, relativePath);
  if (!filePath.startsWith(path.resolve(baseDir))) {
    sendJson(res, 403, { error: "禁止访问" });
    return;
  }
  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : path.join(distDir, "index.html");
  fs.readFile(finalPath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "未找到资源" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypeFor(finalPath),
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/api/configs") {
      const body = await parseJsonBody(req);
      const overrides = canonicalizeOverrides(body.settings);
      const settingsJson = stringifyCanonicalOverrides(overrides);
      const settingsHash = hashOverrides(overrides);
      const existingConfig = selectConfigByHash.get(settingsHash);
      if (existingConfig) {
        sendJson(res, 200, { code: existingConfig.code, settings: mergeSettings(JSON.parse(existingConfig.settings_json)) });
        return;
      }
      for (let attempts = 0; attempts < 20; attempts += 1) {
        const code = generateCode();
        try {
          insertConfig.run(code, settingsJson, settingsHash);
          sendJson(res, 201, { code, settings: mergeSettings(overrides) });
          return;
        } catch (error) {
          if (!String(error).includes("UNIQUE")) {
            throw error;
          }
        }
      }
      sendJson(res, 500, { error: "配置码生成失败，请重试" });
      return;
    }

    const configMatch = pathname.match(/^\/api\/configs\/([^/]+)$/);
    if (req.method === "GET" && configMatch) {
      const code = normalizeCode(configMatch[1]);
      if (!codePattern.test(code)) {
        sendJson(res, 400, { error: "配置码格式无效" });
        return;
      }
      const config = getConfig(code);
      if (!config) {
        sendJson(res, 404, { error: "配置码不存在" });
        return;
      }
      sendJson(res, 200, { code: config.code, settings: mergeSettings(config.overrides) });
      return;
    }

    const iniMatch = pathname.match(/^\/api\/configs\/([^/]+)\/palworldsettings\.ini$/i);
    if (req.method === "GET" && iniMatch) {
      const code = normalizeCode(iniMatch[1]);
      if (!codePattern.test(code)) {
        sendJson(res, 400, { error: "配置码格式无效" });
        return;
      }
      const config = getConfig(code);
      if (!config) {
        sendJson(res, 404, { error: "配置码不存在" });
        return;
      }
      sendText(res, 200, buildPalWorldSettingsIni(mergeSettings(config.overrides)), "text/plain; charset=utf-8");
      return;
    }

    const savMatch = pathname.match(/^\/api\/configs\/([^/]+)\/worldoption\.sav$/i);
    if (req.method === "GET" && savMatch) {
      const code = normalizeCode(savMatch[1]);
      if (!codePattern.test(code)) {
        sendJson(res, 400, { error: "配置码格式无效" });
        return;
      }
      const config = getConfig(code);
      if (!config) {
        sendJson(res, 404, { error: "配置码不存在" });
        return;
      }
      sendBuffer(res, 200, buildWorldOptionSav(mergeSettings(config.overrides)), "application/octet-stream");
      return;
    }

    const envMatch = pathname.match(/^\/api\/configs\/([^/]+)\/env$/i);
    if (req.method === "GET" && envMatch) {
      const code = normalizeCode(envMatch[1]);
      if (!codePattern.test(code)) {
        sendJson(res, 400, { error: "配置码格式无效" });
        return;
      }
      const config = getConfig(code);
      if (!config) {
        sendJson(res, 404, { error: "配置码不存在" });
        return;
      }
      sendText(res, 200, buildStartupEnv(mergeSettings(config.overrides)), "text/plain; charset=utf-8");
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/scripts/")) {
      sendFile(res, publicDir, pathname);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      sendFile(res, distDir, pathname);
      return;
    }

    sendJson(res, 405, { error: "方法不允许" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : "服务器错误" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`pal-conf listening on http://0.0.0.0:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
