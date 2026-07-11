import { useState } from "react"
import { useTranslation, Trans } from 'react-i18next';
import { ChevronDown } from "lucide-react"

import { DeathPenaltyLabels, DifficultyLabels, LogFormatTypeLabels, RandomizerTypeLabels } from "@/consts/dropdownLabels"
import { Label } from "@/components/ui/label"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { I18nStr } from "@/i18n";

type Labels = typeof DeathPenaltyLabels | typeof DifficultyLabels | typeof LogFormatTypeLabels | typeof RandomizerTypeLabels;
export type LabelValue = Labels[number]['name'];
type Key =  'DeathPenalty' | 'Difficulty' | 'LogFormatType' | 'RandomizerType';

function get<T>(dict: Record<string, T> | undefined, key: string, defaultValue: T): T {
    return dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : defaultValue;
}

export function SelectInput(props: {
    dKey: Key;
    label: LabelValue;
    onLabelChange: (label: string) => void;
}) {
    const { dKey, label, onLabelChange } = props;
    const labels = {
      DeathPenalty: DeathPenaltyLabels,
      Difficulty: DifficultyLabels,
      LogFormatType: LogFormatTypeLabels,
      RandomizerType: RandomizerTypeLabels
    }[dKey] as Labels;
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const entryDescriptions = I18nStr.entry.description as Partial<Record<Key, Record<string, string>>>;
    const i18nLabelDesc = get(entryDescriptions[dKey], label, "");
    const optionName = (option: string) => t(`entry.option.${dKey}.${option}`, { defaultValue: option });

    const labelDesc = t(i18nLabelDesc, {
        defaultValue: labels.find((l) => l.name === label)?.desc ?? "",
    });


    return (
        <div className="space-y-1">
            <Label>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger className="cursor-default">
                            <Trans i18nKey={get(I18nStr.entry.name, dKey, "")} />
                            <TooltipContent>
                                <p>{dKey}</p>
                            </TooltipContent>
                        </TooltipTrigger>
                    </Tooltip>
                </TooltipProvider>
            </Label>
            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        className="flex w-full items-center justify-between gap-3 rounded-md border bg-background px-4 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        type="button"
                    >
                        <span className="min-w-0">
                            <span className="mr-2 inline-flex rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground normal-case">
                                {optionName(label)}
                            </span>
                            <span className="text-sm text-muted-foreground">{labelDesc}</span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[min(360px,calc(100vw-2rem))]">
                    <DropdownMenuGroup>
                        <Command>
                            <CommandList>
                                <CommandEmpty>{t("app.noOptions", { defaultValue: "没有可选项" })}</CommandEmpty>
                                <CommandGroup>
                                    {labels.map((label) => (
                                        <CommandItem
                                            className="flex flex-col items-start gap-1"
                                            key={`select-${dKey}-${label.name}`}
                                            value={label.name}
                                            onSelect={() => {
                                                setOpen(false);
                                                onLabelChange(label.name);
                                            }}
                                        >
                                            <span className="font-medium">{optionName(label.name)}</span>
                                            {"desc" in label && label.desc ? (
                                                <span className="text-xs text-muted-foreground">
                                                    {t(get(entryDescriptions[dKey], label.name, ""), { defaultValue: label.desc })}
                                                </span>
                                            ) : null}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
