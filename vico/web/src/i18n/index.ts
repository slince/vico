import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import commonZhCN from './locales/zh-CN/common.json';
import assistantZhCN from './locales/zh-CN/assistant.json';
import sidebarZhCN from './locales/zh-CN/sidebar.json';
import authZhCN from './locales/zh-CN/auth.json';
import dashboardZhCN from './locales/zh-CN/dashboard.json';
import agentsZhCN from './locales/zh-CN/agents.json';
import skillsZhCN from './locales/zh-CN/skills.json';
import conversationsZhCN from './locales/zh-CN/conversations.json';
import knowledgeZhCN from './locales/zh-CN/knowledge.json';
import settingsZhCN from './locales/zh-CN/settings.json';

import commonZhTW from './locales/zh-TW/common.json';
import assistantZhTW from './locales/zh-TW/assistant.json';
import sidebarZhTW from './locales/zh-TW/sidebar.json';
import authZhTW from './locales/zh-TW/auth.json';
import dashboardZhTW from './locales/zh-TW/dashboard.json';
import agentsZhTW from './locales/zh-TW/agents.json';
import skillsZhTW from './locales/zh-TW/skills.json';
import conversationsZhTW from './locales/zh-TW/conversations.json';
import knowledgeZhTW from './locales/zh-TW/knowledge.json';
import settingsZhTW from './locales/zh-TW/settings.json';

import commonEn from './locales/en/common.json';
import assistantEn from './locales/en/assistant.json';
import sidebarEn from './locales/en/sidebar.json';
import authEn from './locales/en/auth.json';
import dashboardEn from './locales/en/dashboard.json';
import agentsEn from './locales/en/agents.json';
import skillsEn from './locales/en/skills.json';
import conversationsEn from './locales/en/conversations.json';
import knowledgeEn from './locales/en/knowledge.json';
import settingsEn from './locales/en/settings.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: commonZhCN,
        sidebar: sidebarZhCN,
        auth: authZhCN,
        dashboard: dashboardZhCN,
        agents: agentsZhCN,
        skills: skillsZhCN,
        conversations: conversationsZhCN,
        knowledge: knowledgeZhCN,
        settings: settingsZhCN,
        assistant: assistantZhCN,
      },
      'zh-TW': {
        common: commonZhTW,
        sidebar: sidebarZhTW,
        auth: authZhTW,
        dashboard: dashboardZhTW,
        agents: agentsZhTW,
        skills: skillsZhTW,
        conversations: conversationsZhTW,
        knowledge: knowledgeZhTW,
        settings: settingsZhTW,
        assistant: assistantZhTW,
      },
      en: {
        common: commonEn,
        sidebar: sidebarEn,
        auth: authEn,
        dashboard: dashboardEn,
        agents: agentsEn,
        skills: skillsEn,
        conversations: conversationsEn,
        knowledge: knowledgeEn,
        settings: settingsEn,
        assistant: assistantEn,
      },
    },
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18n_lang',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

/** 动态更新 HTML lang 属性和页面标题 */
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  document.title = i18n.t('appTitle', { ns: 'common' });
});

export default i18n;
