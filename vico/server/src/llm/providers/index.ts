// @vico/server - LLM 内置厂商目录聚合导出（由拆分脚本生成，勿手改）
// 每个厂商一个 JSON 文件（providers/<id>.json），此处统一静态导入并导出。

import meta from './_meta.json';

import generic from './generic.json';
import weknoracloud from './weknoracloud.json';
import aliyun from './aliyun.json';
import zhipu from './zhipu.json';
import volcengine from './volcengine.json';
import hunyuan from './hunyuan.json';
import siliconflow from './siliconflow.json';
import minimax from './minimax.json';
import moonshot from './moonshot.json';
import mimo from './mimo.json';
import modelscope from './modelscope.json';
import qianfan from './qianfan.json';
import qiniu from './qiniu.json';
import longcat from './longcat.json';
import lkeap from './lkeap.json';
import deepseek from './deepseek.json';
import openai from './openai.json';
import azure_openai from './azure_openai.json';
import anthropic from './anthropic.json';
import gemini from './gemini.json';
import openrouter from './openrouter.json';
import litellm from './litellm.json';
import requesty from './requesty.json';
import jina from './jina.json';
import nvidia from './nvidia.json';
import novita from './novita.json';
import gpustack from './gpustack.json';

export { meta };

/** 全部内置厂商（保持目录文件顺序） */
export const providers = [
  generic,
  weknoracloud,
  aliyun,
  zhipu,
  volcengine,
  hunyuan,
  siliconflow,
  minimax,
  moonshot,
  mimo,
  modelscope,
  qianfan,
  qiniu,
  longcat,
  lkeap,
  deepseek,
  openai,
  azure_openai,
  anthropic,
  gemini,
  openrouter,
  litellm,
  requesty,
  jina,
  nvidia,
  novita,
  gpustack,
];
