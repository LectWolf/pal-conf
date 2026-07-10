import "./App.css";

import { useEffect, useMemo, useRef, useState } from "react";

// i18n
import i18n, { I18nStr } from "./i18n";
import { useTranslation, Trans } from "react-i18next";

// UI Components
import { CardTitle, CardDescription, CardHeader, CardContent, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
// UI Icons
import { AlertCircle, Copy, KeyRound, Languages } from "lucide-react";
import ReactCountryFlag from "react-country-flag";

// App Components
import { TextInput } from "./components/textInput";
import { SelectInput } from "./components/selectInput";
import { MultiSelectInput } from "./components/multiSelectInput";
import { SliderInput } from "./components/sliderInput";
import { SwitchInput } from "./components/switchInput";
import { Input } from "./components/ui/input";

// Constants
import { configVersion } from "../package.json";
import { ENTRIES } from "./consts/entries";
import { AdvancedSettings, InGameSettings, ServerSettings } from "./consts/settings";

// Types
import { LabelValue } from "./components/selectInput";
import { LabelValues } from "./components/multiSelectInput";

interface ChangeEvent<T> {
  target: {
    value: T;
  };
}

interface ConfigCodeResponse {
  code: string;
  settings?: Record<string, string>;
}

enum SettingCategory {
  ServerSettings = "server-settings",
  InGameSettings = "ingame-settings",
  AdvancedSettings = "advanced-settings",
}

const CONFIG_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const RESERVED_LAUNCH_SETTING_IDS = new Set(["PublicPort", "ServerName", "ServerPassword", "AdminPassword"]);

function isConfigurableEntry(id: string) {
  return !RESERVED_LAUNCH_SETTING_IDS.has(id);
}

function normalizeConfigCode(code: string) {
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : code.toUpperCase().trim();
}

function copyText(text: string) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  if (document.queryCommandSupported?.("copy")) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    } finally {
      document.body.removeChild(textarea);
    }
  }
  return Promise.reject(new Error("Copy failed"));
}

function App() {
  const { t } = useTranslation();
  const [locale, setLocale] = useState(i18n.language === "en" ? "en_US" : i18n.language);
  const [entries, setEntries] = useState({} as Record<string, string>);
  const [openedAccordion, setOpenedAccordion] = useState(SettingCategory.ServerSettings);
  const [configCodeInput, setConfigCodeInput] = useState("");
  const [configCode, setConfigCode] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  const tabRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tabRef.current && tabRef.current.getBoundingClientRect().top < 0) {
      tabRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [openedAccordion]);

  const onStateChanged = (id: string) => (e: ChangeEvent<string>) => {
    if (!isConfigurableEntry(id)) {
      return;
    }
    setEntries((prevEntries) => ({ ...prevEntries, [id]: `${e.target.value}` }));
  };

  const getConfigurableSettings = () => {
    const result: Record<string, string> = {};
    Object.values(ENTRIES).forEach((entry) => {
      if (!isConfigurableEntry(entry.id)) {
        return;
      }
      result[entry.id] = entries[entry.id] ?? entry.defaultValue;
    });
    return result;
  };

  const applyLoadedSettings = (loadedSettings: Record<string, unknown>) => {
    const nextEntries: Record<string, string> = {};
    Object.entries(loadedSettings).forEach(([key, value]) => {
      if (key in ENTRIES && isConfigurableEntry(key) && typeof value !== "undefined" && value !== null) {
        nextEntries[key] = String(value);
      }
    });
    setEntries(nextEntries);
  };

  const createConfigCode = async () => {
    setIsSavingConfig(true);
    try {
      const response = await fetch("/api/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: getConfigurableSettings(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ConfigCodeResponse & { error?: string };
      if (!response.ok || !data.code) {
        throw new Error(data.error ?? "保存配置失败");
      }
      setConfigCode(data.code);
      setConfigCodeInput(data.code);
      toast.success("配置码已生成", { description: `${data.code} 永久有效。` });
    } catch (e) {
      console.error(e);
      toast.error("生成配置码失败", { description: e instanceof Error ? e.message : "请稍后重试。" });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const loadConfigCode = async () => {
    const normalizedCode = normalizeConfigCode(configCodeInput);
    if (!CONFIG_CODE_PATTERN.test(normalizedCode)) {
      toast.error("配置码无效", { description: "请输入类似 ABCD-1234 的 4-4 位字母数字配置码。" });
      return;
    }
    setIsLoadingConfig(true);
    try {
      const response = await fetch(`/api/configs/${encodeURIComponent(normalizedCode)}`);
      const data = (await response.json().catch(() => ({}))) as ConfigCodeResponse & { error?: string };
      if (!response.ok || !data.settings) {
        throw new Error(data.error ?? "未找到配置码。");
      }
      applyLoadedSettings(data.settings);
      setConfigCode(data.code);
      setConfigCodeInput(data.code);
      toast.success("配置已读取", { description: `已加载配置码 ${data.code}。` });
    } catch (e) {
      console.error(e);
      toast.error("读取配置码失败", { description: e instanceof Error ? e.message : "请检查配置码后重试。" });
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const genInput = (id: string) => {
    if (!isConfigurableEntry(id)) {
      return null;
    }
    const entry = ENTRIES[id];
    if (!entry) {
      return null;
    }
    const entryName = t(`entry.name.${entry.id}`);
    const entryValue = entries[entry.id] ?? entry.defaultValue;
    if (entry.type === "select") {
      return (
        <SelectInput
          key={id}
          dKey={entry.id as "DeathPenalty" | "LogFormatType" | "RandomizerType"}
          label={entryValue as LabelValue}
          onLabelChange={(labelName: string) => {
            onStateChanged(entry.id)({
              target: { value: labelName },
            });
          }}
        />
      );
    }
    if (entry.type === "array") {
      const labelValues = (entryValue.trim() === "" ? [] : entryValue.split(",")) as LabelValues;
      return (
        <MultiSelectInput
          key={id}
          dKey={entry.id as "CrossplayPlatforms" | "DenyTechnologyList"}
          selectedLabels={labelValues}
          onLabelsChange={(labelNames: string[]) => {
            onStateChanged(entry.id)({
              target: { value: labelNames.join(",") },
            });
          }}
        />
      );
    }
    if ((entry.type === "integer" || entry.type === "float") && entry.range) {
      const minValue = Number(entry.range[0]);
      const maxValue = Number(entry.range[1]);
      const step = entry.type === "integer" ? 1 : 0.000001;
      return (
        <SliderInput
          name={entryName}
          id={id}
          key={id}
          value={Number(entryValue)}
          defaultValue={Number(entry.defaultValue)}
          minValue={minValue}
          maxValue={maxValue}
          step={step}
          onValueChange={(values) => {
            onStateChanged(id)({
              target: { value: `${values[0]}` },
            });
          }}
          type={entry.type}
          difficultyType={entry.difficultyType}
        />
      );
    }
    if (entry.type === "boolean") {
      return (
        <SwitchInput
          name={entryName}
          id={id}
          key={id}
          checked={entryValue === "True"}
          onCheckedChange={(e) => {
            onStateChanged(id)({
              target: { value: e ? "True" : "False" },
            });
          }}
        />
      );
    }
    return (
      <TextInput
        name={entryName}
        id={id}
        key={id}
        value={entryValue}
        onChange={onStateChanged(id)}
        multiline={entry.id === "ServerDescription"}
        {...(entry.type === "integer" ? { type: "number" } : {})}
      />
    );
  };

  const serverSettings = ServerSettings.filter(isConfigurableEntry).map((k) => genInput(k));

  const inGameSettings = InGameSettings.filter(isConfigurableEntry).map((k) => genInput(k));

  const advancedSettings = AdvancedSettings.filter(isConfigurableEntry).map((k) => genInput(k));

  const publicBaseUrl = typeof window === "undefined" ? "" : window.location.origin;
  const generatedScript = useMemo(() => {
    if (!configCode) {
      return "";
    }
    return `#!/usr/bin/env sh
set -eu

export PAL_CONF_BASE_URL="\${PAL_CONF_BASE_URL:-${publicBaseUrl}}"
export PAL_CONF_CODE="\${PAL_CONF_CODE:-${configCode}}"

: "\${SERVER_PORT:?请设置 SERVER_PORT}"
: "\${SERVER_NAME:?请设置 SERVER_NAME}"
: "\${ADMIN_PASSWORD:?请设置 ADMIN_PASSWORD}"
RCON_PORT="\${RCON_PORT:-25575}"

if [ ! -x ./PalworldServerConfigParser ]; then
  curl -fsSL "\${PAL_CONF_BASE_URL%/}/scripts/PalworldServerConfigParser" -o ./PalworldServerConfigParser
  chmod +x ./PalworldServerConfigParser
fi

./palstarted.sh
./PalworldServerConfigParser

(
  while read -r cmd; do
    rcon -s -a "localhost:\${RCON_PORT}" -p "\${ADMIN_PASSWORD}" "\${cmd}"
  done
) < /dev/stdin &

set -- /home/container/Pal/Binaries/Linux/PalServer-Linux-Shipping Pal \\
  -publiclobby \\
  -useperfthreads \\
  -NoAsyncLoadingThread \\
  -UseMultithreadForDS \\
  "-port=\${SERVER_PORT}" \\
  "-servername=\${SERVER_NAME}" \\
  "-adminpassword=\${ADMIN_PASSWORD}" \\
  -rcon

if [ -n "\${SERVER_PASSWORD:-}" ]; then
  set -- "$@" "-serverpassword=\${SERVER_PASSWORD}"
fi

exec "$@"
`;
  }, [configCode, publicBaseUrl]);

  useEffect(() => {
    document.title = t(I18nStr.title);
  }, [t]);

  return (
    <>
      <main className="flex flex-col items-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
        <Toaster richColors />
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle className="flex">
              <div className="leading-10">
                <Trans i18nKey={I18nStr.title} />
                <Badge variant="secondary" className="ml-2">
                  <a
                    href="https://docs.palworldgame.com/settings-and-operation/configuration/"
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {configVersion}
                  </a>
                </Badge>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="ml-auto h-10" variant="secondary">
                    <Languages />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={locale}
                    onValueChange={(value) => {
                      i18n
                        .changeLanguage(value)
                        .catch((e) => {
                          console.error(e);
                        });
                      setLocale(value);
                    }}
                  >
                    <DropdownMenuRadioItem value="en_US">
                      <ReactCountryFlag countryCode="US" svg />
                      <div className="px-2"> English </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="zh_CN">
                      <ReactCountryFlag countryCode="CN" svg />
                      <div className="px-2"> 简体中文 </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="zh_TW">
                      <ReactCountryFlag countryCode="TW" svg />
                      <div className="px-2"> 繁體中文 </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="ja_JP">
                      <ReactCountryFlag countryCode="JP" svg />
                      <div className="px-2"> 日本語 </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="ko_KR">
                      <ReactCountryFlag countryCode="KR" svg />
                      <div className="px-2"> 한국인 </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="de_DE">
                      <ReactCountryFlag countryCode="DE" svg />
                      <div className="px-2"> Deutsch </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="pt_BR">
                      <ReactCountryFlag countryCode="BR" svg />
                      <div className="px-2"> Português </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="es_ES">
                      <ReactCountryFlag countryCode="ES" svg />
                      <div className="px-2"> Español </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="fr_FR">
                      <ReactCountryFlag countryCode="FR" svg />
                      <div className="px-2"> Français </div>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardTitle>
            <CardDescription>
              当前页面只生成配置码。服务器端口、服务器名称、服务器密码、管理员密码请通过启动脚本环境变量传入。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4" ref={tabRef}>
            <Tabs value={openedAccordion} className="flex flex-col w-full min-h-10" onValueChange={(v) => setOpenedAccordion(v as SettingCategory)}>
              <TabsList className="sticky top-2 z-10 shadow-lg">
                <TabsTrigger className="w-[33%] whitespace-normal" value={SettingCategory.ServerSettings}>
                  <Trans i18nKey={I18nStr.serverSettings} />
                </TabsTrigger>
                <TabsTrigger className="w-[33%] whitespace-normal" value={SettingCategory.InGameSettings}>
                  <Trans i18nKey={I18nStr.ingameSettings} />
                </TabsTrigger>
                <TabsTrigger className="w-[33%] whitespace-normal" value={SettingCategory.AdvancedSettings}>
                  <Trans i18nKey={I18nStr.advancedSettings} />
                </TabsTrigger>
              </TabsList>
              <div className="mt-4 overflow-hidden">
                <TabsContent value={SettingCategory.ServerSettings} className="space-y-2">
                  {serverSettings}
                </TabsContent>
                <TabsContent value={SettingCategory.InGameSettings} className="space-y-2">
                  {inGameSettings}
                </TabsContent>
                <TabsContent value={SettingCategory.AdvancedSettings} className="space-y-2">
                  {advancedSettings}
                </TabsContent>
              </div>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="w-full max-w-3xl mt-8 sticky bottom-0 z-10 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-5 w-5" />
              配置码
            </CardTitle>
            <CardDescription>配置码永久有效，可在网页读取，也可交给服务器启动脚本下载配置文件。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={configCodeInput}
                onChange={(e) => setConfigCodeInput(normalizeConfigCode(e.target.value))}
                placeholder="ABCD-1234"
                className="font-mono"
              />
              <Button variant="secondary" onClick={() => void loadConfigCode()} disabled={isLoadingConfig}>
                读取配置码
              </Button>
              <Button onClick={() => void createConfigCode()} disabled={isSavingConfig}>
                生成配置码
              </Button>
            </div>
            {configCode && (
              <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
                <div className="text-sm text-muted-foreground">当前配置码</div>
                <div className="font-mono text-lg font-semibold tracking-widest">{configCode}</div>
                <Button
                  className="sm:ml-auto"
                  variant="outline"
                  onClick={() =>
                    void copyText(configCode)
                      .then(() => toast.success("配置码已复制"))
                      .catch(() => toast.error("复制失败"))
                  }
                >
                  <Copy className="mr-2 h-4 w-4" />
                  复制
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Alert className="w-full max-w-3xl mt-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>启动参数不写入配置码</AlertTitle>
          <AlertDescription className="text-wrap break-all whitespace-pre-wrap">
            已排除 PublicPort、ServerName、ServerPassword、AdminPassword。请用 SERVER_PORT、SERVER_NAME、SERVER_PASSWORD、ADMIN_PASSWORD 环境变量提供给启动脚本。
          </AlertDescription>
        </Alert>

        <Card className="w-full max-w-3xl mt-8">
          <CardHeader>
            <CardTitle className="text-lg">启动脚本</CardTitle>
            <CardDescription>生成配置码后复制这段脚本。脚本会下载 PalworldServerConfigParser，并用配置码替换服务器上的 PalWorldSettings.ini。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              readOnly
              value={generatedScript || "生成配置码后，这里会出现可复制的启动脚本。"}
              className="min-h-[360px] font-mono text-xs"
            />
            <Button
              variant="outline"
              disabled={!generatedScript}
              onClick={() =>
                void copyText(generatedScript)
                  .then(() => toast.success("启动脚本已复制"))
                  .catch(() => toast.error("复制失败"))
              }
            >
              <Copy className="mr-2 h-4 w-4" />
              复制启动脚本
            </Button>
          </CardContent>
        </Card>

        <div className="w-full max-w-3xl flex justify-center pt-2">
          2024-{`${new Date().getFullYear()}`} @LectWolf
          <a
            href="https://github.com/LectWolf/pal-conf"
            className="pl-2 font-medium text-primary underline underline-offset-4 top-2"
            target="_blank"
            rel="noreferrer"
          >
            Github
          </a>
          {__COMMIT_HASH__ && `@${__COMMIT_HASH__}`}
        </div>
      </main>
    </>
  );
}

export default App;
