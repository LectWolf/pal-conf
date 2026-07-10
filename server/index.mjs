import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
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

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    code TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertConfig = db.prepare("INSERT INTO configs (code, settings_json) VALUES (?, ?)");
const selectConfig = db.prepare("SELECT code, settings_json FROM configs WHERE code = ?");

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
    if (value !== String(entry.defaultValue)) {
      overrides[id] = value;
    }
  }
  return overrides;
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
      const overrides = sanitizeOverrides(body.settings);
      for (let attempts = 0; attempts < 20; attempts += 1) {
        const code = generateCode();
        try {
          insertConfig.run(code, JSON.stringify(overrides));
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
