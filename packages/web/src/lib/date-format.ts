import { format, formatDistanceToNow } from 'date-fns';
import { zhCN, zhTW, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import i18n from '@/i18n';

/** 语言标识到 date-fns Locale 的映射 */
const LOCALE_MAP: Record<string, Locale> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en: enUS,
};

/** 获取当前 i18n 语言对应的 date-fns Locale */
export function getDateLocale(): Locale {
  return LOCALE_MAP[i18n.language] || zhCN;
}

/**
 * 按指定格式格式化日期
 * @param date - Date 对象、ISO 字符串或 Unix 毫秒时间戳
 * @param fmt - date-fns 格式字符串
 * @returns 格式化后的日期文本
 */
export function formatDate(date: Date | string, fmt: string): string {
  return format(new Date(date), fmt, { locale: getDateLocale() });
}

/**
 * 格式化为 "yyyy-MM-dd HH:mm:ss" 的完整日期时间
 * @param date - Date 对象、ISO 字符串或 Unix 毫秒时间戳
 * @returns 格式化后的日期时间文本
 */
export function formatDateTime(date: Date | string): string {
  return format(new Date(date), 'yyyy-MM-dd HH:mm:ss', { locale: getDateLocale() });
}

/**
 * 格式化为 "yyyy-MM-dd" 的日期
 * @param date - Date 对象、ISO 字符串或 Unix 毫秒时间戳
 * @returns 格式化后的日期文本
 */
export function formatDateOnly(date: Date | string | number): string {
  return format(new Date(date), 'yyyy-MM-dd', { locale: getDateLocale() });
}

/**
 * 格式化为 "HH:mm:ss" 的时间
 * @param date - Date 对象、ISO 字符串或 Unix 毫秒时间戳
 * @returns 格式化后的时间文本
 */
export function formatTimeOnly(date: Date | string): string {
  return format(new Date(date), 'HH:mm:ss', { locale: getDateLocale() });
}

/**
 * 格式化相对时间（如 "3 分钟前"、"2 小时前"）
 * @param date - Date 对象、ISO 字符串或 Unix 毫秒时间戳
 * @returns 相对时间文本
 */
export function formatRelative(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: getDateLocale() });
}
