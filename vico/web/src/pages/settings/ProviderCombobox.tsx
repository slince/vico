import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { ProviderEntry } from './providers';

/** ProviderCombobox 组件属性 */
interface ProviderComboboxProps {
  /** 可选厂商列表 */
  providers: ProviderEntry[];
  /** 当前选中的厂商 ID */
  value: string;
  /** 厂商变更回调 */
  onChange: (id: string) => void;
  /** 未选中时的占位文案 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 可搜索、可滚动的厂商选择下拉。
 *
 * 基于 Popover + Command（cmdk）：输入框支持按厂商名/英文名快速过滤，
 * 列表超出高度后滚动。替换原生的 Select 以承载 27 家厂商的检索需求。
 *
 * @param props - 组件属性
 */
export function ProviderCombobox({ providers, value, onChange, placeholder, disabled }: ProviderComboboxProps) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);

  const selected = providers.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
            {selected?.name ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={t('llm.searchProvider')} />
          <CommandList>
            <CommandEmpty>{t('llm.noProviderFound')}</CommandEmpty>
            <CommandGroup>
              {providers.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  keywords={p.name_en ? [p.name, p.name_en] : [p.name]}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {value === p.id && <Check className="size-4 shrink-0 text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
