import "./App.css";

import { useEffect, useMemo, useState } from "react";

// i18n
import i18n, { I18nStr } from "./i18n";
import { Trans, useTranslation } from "react-i18next";

// UI Components
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
// UI Icons
import {
  Copy,
  Flag,
  Globe2,
  Hammer,
  KeyRound,
  Languages,
  Mic,
  Package,
  PawPrint,
  RotateCcw,
  Search,
  Server,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  TrendingUp,
  UserRound,
  UsersRound,
} from "lucide-react";
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
import { SettingGroups, SettingSections } from "./consts/settings";

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

const CONFIG_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const RESERVED_LAUNCH_SETTING_IDS = new Set([
  "PublicPort",
  "PublicIP",
  "RCONEnabled",
  "RCONPort",
  "RESTAPIEnabled",
  "RESTAPIPort",
]);

const GROUP_ICONS = {
  globe: Globe2,
  user: UserRound,
  paw: PawPrint,
  hammer: Hammer,
  package: Package,
  flag: Flag,
  users: UsersRound,
  swords: Swords,
  trend: TrendingUp,
  server: Server,
  shield: Shield,
  mic: Mic,
  sliders: SlidersHorizontal,
};

type Group = (typeof SettingGroups)[number];
type GroupIconName = Group["icon"];
type GroupText = Pick<Group, "id" | "name" | "description">;
type Entry = (typeof ENTRIES)[string];

function isConfigurableEntry(id: string) {
  return !RESERVED_LAUNCH_SETTING_IDS.has(id);
}

function normalizeConfigCode(code: string) {
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : code.toUpperCase().trim();
}

function isSameEntryValue(entry: Entry, value: unknown, otherValue = entry.defaultValue) {
  if (entry.type === "integer" || entry.type === "float") {
    return Number(value) === Number(otherValue);
  }
  return String(value) === String(otherValue);
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
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<Group["id"]>(SettingGroups[0].id);
  const [configCodeInput, setConfigCodeInput] = useState("");
  const [configCode, setConfigCode] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  const entryName = (id: string) => t(`entry.name.${id}`, { defaultValue: ENTRIES[id]?.name ?? id });
  const sectionName = (section: (typeof SettingSections)[number]) =>
    t(`section.${section.id}`, { defaultValue: section.name });
  const groupName = (group: GroupText) => t(`group.${group.id}.name`, { defaultValue: group.name });
  const groupDescription = (group: GroupText) =>
    t(`group.${group.id}.description`, { defaultValue: group.description });

  const getEntryValue = (id: string) => entries[id] ?? ENTRIES[id]?.defaultValue ?? "";

  const changedIds = useMemo(() => {
    return new Set(
      Object.values(ENTRIES)
        .filter((entry) => isConfigurableEntry(entry.id))
        .filter((entry) => !isSameEntryValue(entry, entries[entry.id] ?? entry.defaultValue))
        .map((entry) => entry.id)
    );
  }, [entries]);

  const changedByGroup = useMemo(() => {
    return Object.fromEntries(
      SettingGroups.map((group) => [group.id, group.settings.filter((id) => changedIds.has(id)).length])
    ) as Record<Group["id"], number>;
  }, [changedIds]);

  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return SettingGroups.map((group) => {
      const settings = group.settings
        .filter((id) => isConfigurableEntry(id) && ENTRIES[id])
        .filter((id) => {
          if (!normalizedQuery) {
            return true;
          }
          const entry = ENTRIES[id];
          return [id, entryName(id), entry.name, entry.desc ?? "", groupName(group), groupDescription(group)]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        });
      return { ...group, settings };
    }).filter((group) => group.settings.length > 0);
    // entryName depends on i18n state through t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t]);

  const visibleSections = useMemo(() => {
    const groupIds = new Set(visibleGroups.map((group) => group.id));
    return SettingSections.map((section) => ({
      ...section,
      groups: SettingGroups.filter((group) => group.section === section.id && groupIds.has(group.id)),
    })).filter((section) => section.groups.length > 0);
  }, [visibleGroups]);

  const visibleSettingCount = visibleGroups.reduce((total, group) => total + group.settings.length, 0);
  const configurableSettingCount = Object.values(ENTRIES).filter((entry) => isConfigurableEntry(entry.id)).length;

  const onStateChanged = (id: string) => (e: ChangeEvent<string>) => {
    if (!isConfigurableEntry(id)) {
      return;
    }
    setEntries((prevEntries) => ({ ...prevEntries, [id]: `${e.target.value}` }));
  };

  const resetEntry = (id: string) => {
    setEntries((prevEntries) => {
      const nextEntries = { ...prevEntries };
      delete nextEntries[id];
      return nextEntries;
    });
  };

  const resetAll = () => {
    setEntries({});
    toast.success(t("app.toastReset", { defaultValue: "已恢复默认配置" }));
  };

  const getConfigurableSettings = () => {
    const result: Record<string, string> = {};
    Object.values(ENTRIES).forEach((entry) => {
      if (!isConfigurableEntry(entry.id)) {
        return;
      }
      const value = entries[entry.id] ?? entry.defaultValue;
      result[entry.id] = isSameEntryValue(entry, value) ? entry.defaultValue : String(value);
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
        throw new Error(data.error ?? t("app.saveFailed", { defaultValue: "保存配置失败" }));
      }
      setConfigCode(data.code);
      setConfigCodeInput(data.code);
      toast.success(t("app.toastCodeGenerated", { defaultValue: "配置码已生成" }), {
        description: t("app.toastCodeGeneratedDescription", {
          code: data.code,
          defaultValue: `${data.code} 永久有效。`,
        }),
      });
    } catch (e) {
      console.error(e);
      toast.error(t("app.toastCodeGenerateFailed", { defaultValue: "生成配置码失败" }), {
        description: e instanceof Error ? e.message : t("app.tryLater", { defaultValue: "请稍后重试。" }),
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const loadConfigCode = async () => {
    const normalizedCode = normalizeConfigCode(configCodeInput);
    if (!CONFIG_CODE_PATTERN.test(normalizedCode)) {
      toast.error(t("app.toastInvalidCode", { defaultValue: "配置码无效" }), {
        description: t("app.invalidCodeDescription", { defaultValue: "请输入类似 ABCD-1234 的 4-4 位字母数字配置码。" }),
      });
      return;
    }
    setIsLoadingConfig(true);
    try {
      const response = await fetch(`/api/configs/${encodeURIComponent(normalizedCode)}`);
      const data = (await response.json().catch(() => ({}))) as ConfigCodeResponse & { error?: string };
      if (!response.ok || !data.settings) {
        throw new Error(data.error ?? t("app.codeNotFound", { defaultValue: "未找到配置码。" }));
      }
      applyLoadedSettings(data.settings);
      setConfigCode(data.code);
      setConfigCodeInput(data.code);
      toast.success(t("app.toastCodeLoaded", { defaultValue: "配置已读取" }), {
        description: t("app.toastCodeLoadedDescription", {
          code: data.code,
          defaultValue: `已加载配置码 ${data.code}。`,
        }),
      });
    } catch (e) {
      console.error(e);
      toast.error(t("app.toastCodeLoadFailed", { defaultValue: "读取配置码失败" }), {
        description: e instanceof Error ? e.message : t("app.checkCodeAndRetry", { defaultValue: "请检查配置码后重试。" }),
      });
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const renderInput = (id: string) => {
    if (!isConfigurableEntry(id)) {
      return null;
    }
    const entry = ENTRIES[id];
    if (!entry) {
      return null;
    }
    const name = entryName(entry.id);
    const value = getEntryValue(entry.id);
    if (entry.type === "select") {
      return (
        <SelectInput
          key={id}
          dKey={entry.id as "DeathPenalty" | "Difficulty" | "LogFormatType" | "RandomizerType"}
          label={value as LabelValue}
          onLabelChange={(labelName: string) => {
            onStateChanged(entry.id)({
              target: { value: labelName },
            });
          }}
        />
      );
    }
    if (entry.type === "array") {
      const labelValues = (value.trim() === "" ? [] : value.split(",")) as LabelValues;
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
          name={name}
          id={id}
          key={id}
          value={Number(value)}
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
          name={name}
          id={id}
          key={id}
          checked={value === "True"}
          onCheckedChange={(checked) => {
            onStateChanged(id)({
              target: { value: checked ? "True" : "False" },
            });
          }}
        />
      );
    }
    return (
      <TextInput
        name={name}
        id={id}
        key={id}
        value={value}
        onChange={onStateChanged(id)}
        multiline={entry.id === "ServerDescription"}
        {...(entry.type === "integer" ? { type: "number" } : {})}
      />
    );
  };

  const scrollToGroup = (groupId: Group["id"]) => {
    setActiveGroup(groupId);
    document.getElementById(`group-${groupId}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const renderGroupIcon = (icon: GroupIconName, className = "h-4 w-4") => {
    const Icon = GROUP_ICONS[icon] ?? SlidersHorizontal;
    return <Icon className={className} />;
  };

  useEffect(() => {
    document.title = t(I18nStr.title);
  }, [t]);

  return (
    <main className="pal-page">
      <Toaster richColors />

      <header className="pal-topbar">
        <div className="pal-brand">
          <div className="pal-brand-mark">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1>
                <Trans i18nKey={I18nStr.title} />
              </h1>
              <Badge variant="secondary" className="pal-version">
                <a
                  href="https://docs.palworldgame.com/settings-and-operation/configuration/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {configVersion}
                </a>
              </Badge>
            </div>
            <p>{t("app.subtitle", { defaultValue: "按玩法分类调整配置，生成配置码后交给服务器启动配置使用。" })}</p>
          </div>
        </div>

        <label className="pal-search" aria-label={t("app.searchAria", { defaultValue: "搜索配置项" })}>
          <Search className="h-4 w-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("app.searchPlaceholder", { defaultValue: "搜索配置项、键名或说明" })}
            type="search"
          />
        </label>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="pal-language" variant="secondary" aria-label={t("app.languageAria", { defaultValue: "切换语言" })}>
              <Languages className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(value) => {
                i18n.changeLanguage(value).catch((e) => {
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
      </header>

      <div className="pal-layout">
        <aside className="pal-sidebar" aria-label={t("app.categoryAria", { defaultValue: "配置分类" })}>
          {visibleSections.map((section) => (
            <div className="pal-nav-section" key={section.id}>
              <p>{sectionName(section)}</p>
              {section.groups.map((group) => (
                <button
                  className={activeGroup === group.id ? "active" : ""}
                  key={group.id}
                  type="button"
                  onClick={() => scrollToGroup(group.id)}
                >
                  <span>
                    {renderGroupIcon(group.icon)}
                    {groupName(group)}
                  </span>
                  {changedByGroup[group.id] > 0 && <strong>{changedByGroup[group.id]}</strong>}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <section className="pal-content" aria-label={t("app.settingsAria", { defaultValue: "配置项" })}>
          <div className="pal-overview">
            <div>
              <span>{configurableSettingCount}</span>
              <p>{t("app.totalSettings", { defaultValue: "全部配置" })}</p>
            </div>
            <div>
              <span>{changedIds.size}</span>
              <p>{t("app.changedSettings", { defaultValue: "已修改" })}</p>
            </div>
            <div>
              <span>{visibleSettingCount}</span>
              <p>{t("app.visibleSettings", { defaultValue: "当前显示" })}</p>
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <div className="pal-empty">
              <Search className="h-6 w-6" />
              <p>{t("app.noMatchedSettings", { defaultValue: "没有匹配的配置项" })}</p>
              <Button variant="secondary" onClick={() => setQuery("")}>
                {t("app.clearSearch", { defaultValue: "清除搜索" })}
              </Button>
            </div>
          ) : (
            visibleGroups.map((group) => (
              <section className="pal-group" id={`group-${group.id}`} key={group.id}>
                <div className="pal-group-head">
                  <div className="pal-group-icon">{renderGroupIcon(group.icon, "h-5 w-5")}</div>
                  <div>
                    <h2>{groupName(group)}</h2>
                    <p>{groupDescription(group)}</p>
                  </div>
                  <Badge variant="outline" className="ml-auto">
                    {t("app.itemCount", { count: group.settings.length, defaultValue: `${group.settings.length} 项` })}
                  </Badge>
                </div>
                <div className="pal-setting-grid">
                  {group.settings.map((id) => (
                    <div className={changedIds.has(id) ? "pal-setting changed" : "pal-setting"} key={id}>
                      {renderInput(id)}
                      <div className="pal-setting-foot">
                        <code>{id}</code>
                        {changedIds.has(id) && (
                          <Button
                            className="h-7 gap-1 px-2"
                            size="sm"
                            variant="ghost"
                            onClick={() => resetEntry(id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t("app.resetDefault", { defaultValue: "默认" })}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </section>

        <aside className="pal-actions" aria-label={t("app.codeActionsAria", { defaultValue: "配置码操作" })}>
          <section className="pal-code-panel">
            <div className="pal-code-title">
              <KeyRound className="h-5 w-5" />
              <div>
                <h2>{t("app.configCode", { defaultValue: "配置码" })}</h2>
                <p>{t("app.configCodeDescription", { defaultValue: "永久有效，可在网页读取，也可交给服务器端配置工具使用。" })}</p>
              </div>
            </div>
            <Input
              value={configCodeInput}
              onChange={(event) => setConfigCodeInput(normalizeConfigCode(event.target.value))}
              placeholder="ABCD-1234"
              className="font-mono"
            />
            <div className="pal-code-actions">
              <Button variant="secondary" onClick={() => void loadConfigCode()} disabled={isLoadingConfig}>
                {t("app.loadCode", { defaultValue: "读取配置码" })}
              </Button>
              <Button onClick={() => void createConfigCode()} disabled={isSavingConfig}>
                {t("app.generateCode", { defaultValue: "生成配置码" })}
              </Button>
            </div>
            {configCode && (
              <div className="pal-current-code">
                <span>{t("app.currentCode", { defaultValue: "当前配置码" })}</span>
                <strong>{configCode}</strong>
                <Button
                  variant="outline"
                  onClick={() =>
                    void copyText(configCode)
                      .then(() => toast.success(t("app.toastCodeCopied", { defaultValue: "配置码已复制" })))
                      .catch(() => toast.error(t("app.copyFailed", { defaultValue: "复制失败" })))
                  }
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {t("copy", { defaultValue: "复制" })}
                </Button>
              </div>
            )}
          </section>

          <section className="pal-summary-panel">
            <h2>{t("app.currentDraft", { defaultValue: "当前草稿" })}</h2>
            <p>
              {changedIds.size
                ? t("app.draftChanged", { count: changedIds.size, defaultValue: `已修改 ${changedIds.size} 项配置` })
                : t("app.draftDefault", { defaultValue: "当前为默认配置" })}
            </p>
            <Button className="w-full" variant="outline" onClick={resetAll} disabled={!changedIds.size}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("app.resetAll", { defaultValue: "全部恢复默认" })}
            </Button>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default App;
