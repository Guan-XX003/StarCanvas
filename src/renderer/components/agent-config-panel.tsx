/**
 * 智能体配置面板（agentConfigOpen 弹层）：模型/知识库/主题等设置。
 * 自 WanJuanAppRoot 抽出为子组件，props 传入依赖，行为不变。
 */
import { jsx, jsxs } from "react/jsx-runtime";
import {useSyncExternalStore} from 'react';
import { agentIconOptions, getAgentIconKey, renderAgentIconGlyph } from "../lib/agent";
import {roleEditorText,roleKnowledgeCount,roleKnowledgeTime} from '../lib/assistant-role-editor-copy';
declare const chrome: any;
const i18n=()=>(globalThis as any).wanjuanI18nRuntime;
const subscribeLanguage=(listener:()=>void)=>i18n()?.subscribe?.(listener)||(()=>{});
const readLanguage=()=>i18n()?.getLanguage?.()||'zh-CN';

export function WanJuanAgentConfigPanel({
  agentModelOptions,
  agentTheme,
  apiConfigs,
  importAgentKnowledgeFile,
  isLightAgentTheme,
  removeAgentKnowledgeFile,
  selectedAgent,
  setAgentConfigOpen,
  textApiConfigId,
  textModelApiBindings,
  updateSelectedAgent,
  stagedSave,
  saving,
  saveError,
  onCancel,
  language,
}: any) {
  const currentLanguage=useSyncExternalStore(subscribeLanguage,readLanguage,()=> 'zh-CN');
  const locale=language||currentLanguage,tr=(text:string)=>roleEditorText(text,locale);
  const modelOptions=[...new Set([...(agentModelOptions||[]),...(selectedAgent?.model?[selectedAgent.model]:[])])];
  return jsx(`div`, {
                  'data-wanjuan-i18n-skip':true,
                  className: `fixed inset-0 flex items-center justify-center`,
                  style: {
                    zIndex: 1200,
                    background: agentTheme.overlayBg,
                  },
                  children: selectedAgent &&
                    jsxs(`div`, {
                      role:'dialog','aria-modal':true,'aria-label':tr(stagedSave?'角色设置':'智能体配置'),
                      className: `wj-assistant-role-editor flex flex-col overflow-hidden shadow-[0_28px_80px_rgba(0,0,0,0.48),0_10px_30px_rgba(0,0,0,0.34)]`,
                      style: {
                        width: `min(70vw, 1120px)`,
                        height: `min(70vh, 746px)`,
                        borderRadius: `32px`,
                        aspectRatio: `3 / 2`,
                        zIndex: 1201,
                        position: `relative`,
                        background: agentTheme.modalBg,
                        boxShadow: `0 32px 90px rgba(0,0,0,0.30), 0 10px 26px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(255,255,255,0.03)`,
                        backdropFilter: `blur(22px) saturate(135%)`,
                        WebkitBackdropFilter: `blur(22px) saturate(135%)`,
                        border: `1px solid ${agentTheme.modalBorder}`,
                      },
                      children: [
                        jsx(`div`, {
                          className: `pointer-events-none absolute inset-x-0 top-0 h-24`,
                          style: {
                            background: `linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.03) 38%,rgba(255,255,255,0) 100%)`,
                          },
                        }),
                        jsxs(`div`, {
                          className: `h-16 px-6 flex items-center justify-between`,
                          style: {
                            borderBottom: `1px solid ${agentTheme.modalBorder}`,
                            background: agentTheme.modalHeaderBg,
                            backdropFilter: `blur(18px) saturate(130%)`,
                            WebkitBackdropFilter: `blur(18px) saturate(130%)`,
                          },
                          children: [
                            jsxs(`div`, {
                              className: `flex items-center gap-3 text-center`,
                              children: [
                                jsx(`div`, {
                                  className: `text-sm font-semibold`,
                                  style: {
                                    color: agentTheme.textPrimary
                                  },
                                  children: tr(stagedSave?'角色设置':'智能体配置'),
                                }),
                                jsxs(`span`, {
                                  className: `inline-flex flex-shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[10px]`,
                                  style: {
                                    border: `1px solid ${agentTheme.accentBorder}`,
                                    background: agentTheme.accentBg,
                                    color: agentTheme.accentText,
                                  },
                                  children: [
                                    jsx(`span`, {
                                      className: `w-1.5 h-1.5 rounded-full`,
                                      style: {
                                        background: agentTheme.accentText
                                      },
                                    }),
                                    tr(stagedSave?'保存后生效':'实时生效'),
                                  ],
                                }),
                              ],
                            }),
                            jsx(`button`, {
                              disabled: !!saving,
                              onClick: () => setAgentConfigOpen(false),
                              className: `inline-flex items-center justify-center rounded-full px-4 py-1.5 text-[11px] font-medium transition-colors`,
                              style: {
                                border: `1px solid ${agentTheme.accentBorder}`,
                                background: isLightAgentTheme ?
                                  `linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.64))` :
                                  `linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.08))`,
                                color: agentTheme.textPrimary,
                              },
                              children: saving ? tr(`正在保存…`) : tr(`完成并保存`),
                            }),
                            onCancel && jsx(`button`, {type:`button`,disabled:!!saving,onClick:onCancel,className:`wj-assistant-text-button`,children:tr(`取消`)}),
                          ],
                        }),
                        jsxs(`div`, {
                          inert: saving ? true : undefined,
                          className: `flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar`,
                          style: {
                            background: agentTheme.modalBg,
                          },
                          children: [
                            saveError && jsx(`p`,{role:`alert`,className:`wj-assistant-error`,children:saveError}),
                            stagedSave && jsxs(`label`,{className:`block`,children:[
                              jsx(`span`,{className:`text-xs block mb-2`,children:tr(`记忆范围（仅开启长期记忆时使用）`)}),
                              jsxs(`select`,{value:selectedAgent.memoryScope||`session`,onChange:event=>updateSelectedAgent({memoryScope:event.target.value}),className:`w-full rounded-xl px-3 py-2 text-sm`,style:{background:agentTheme.inputBg,color:agentTheme.inputText,border:`1px solid ${agentTheme.inputBorder}`},children:[jsx(`option`,{value:`session`,children:tr(`仅当前会话（默认）`)}),jsx(`option`,{value:`role`,children:tr(`此角色的全部会话（明确共享）`)})]}),
                            ]}),
                            jsx(`div`, {
                              className: `text-center text-[11px] leading-5 px-6`,
                              style: {
                                color: agentTheme.textSecondary
                              },
                              children: stagedSave ? tr(`保存后用于此角色的新请求；正在运行的任务继续使用提交时的配置。`) : tr(`修改角色定位、模型绑定和知识内容，当前页会实时生效。`),
                            }),
                            jsxs(`div`, {
                              className: `rounded-2xl p-4 space-y-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]`,
                              style: {
                                border: `1px solid ${agentTheme.modalBorder}`,
                                background: agentTheme.modalSectionBg,
                                backdropFilter: `blur(16px) saturate(128%)`,
                                WebkitBackdropFilter: `blur(16px) saturate(128%)`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.12)`,
                              },
                              children: [
                                jsx(`div`, {
                                  className: `text-[10px] uppercase tracking-[0.16em]`,
                                  style: {
                                    color: agentTheme.textMuted
                                  },
                                  children: tr(`基础信息`),
                                }),
                                jsxs(`label`, {
                                  className: `block`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-xs mb-2`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: tr(`名称`),
                                    }),
                                    jsx(`input`, {
                                      value: selectedAgent.name || ``,
                                      onChange: (event) =>
                                        updateSelectedAgent({
                                          name: event.target.value,
                                        }),
                                      className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                      style: {
                                        border: `1px solid ${agentTheme.inputBorder}`,
                                        background: agentTheme.inputBg,
                                        color: agentTheme.inputText,
                                      },
                                    }),
                                  ],
                                }),
                                jsxs(`label`, {
                                  className: `block`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-xs mb-2`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: tr(`简介`),
                                    }),
                                    jsx(`textarea`, {
                                      value: selectedAgent.description || ``,
                                      onChange: (event) =>
                                        updateSelectedAgent({
                                          description: event.target.value,
                                        }),
                                      className: `w-full min-h-[72px] resize-y rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                      style: {
                                        border: `1px solid ${agentTheme.inputBorder}`,
                                        background: agentTheme.inputBg,
                                        color: agentTheme.inputText,
                                      },
                                    }),
                                  ],
                                }),
                                jsxs(`div`, {
                                  className: `space-y-3`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-xs`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: tr(`图标`),
                                    }),
                                    jsx(`div`, {
                                      className: `grid grid-cols-3 gap-2`,
                                      children: agentIconOptions.map((iconOption) => {
                                        let iconKey =
                                          getAgentIconKey(
                                            selectedAgent.icon,
                                          ) === iconOption.key;
                                        return jsxs(
                                          `button`, {
                                            type: `button`,
                                            onClick: () =>
                                              updateSelectedAgent({
                                                icon: iconOption.key,
                                              }),
                                            className: `group rounded-2xl border px-3 py-3 text-left transition-colors`,
                                            style: iconKey ?
                                              {
                                                borderColor: agentTheme.accentBorder,
                                                background: agentTheme.accentBg,
                                                boxShadow: `0 0 0 1px ${agentTheme.accentBorder} inset`,
                                              } :
                                              {
                                                borderColor: agentTheme.inputBorder,
                                                background: agentTheme.inputBg,
                                              },
                                            children: [
                                              jsx(`div`, {
                                                className: `mb-2 w-10 h-10 rounded-2xl border flex items-center justify-center`,
                                                style: iconKey ?
                                                  {
                                                    borderColor: agentTheme.accentBorder,
                                                    background: agentTheme.accentBg,
                                                    color: agentTheme.accentText,
                                                  } :
                                                  {
                                                    borderColor: agentTheme.inputBorder,
                                                    background: agentTheme.inputBg,
                                                    color: agentTheme.textSecondary,
                                                  },
                                                children: renderAgentIconGlyph(
                                                  iconOption.key,
                                                  18,
                                                ),
                                              }),
                                              jsx(`div`, {
                                                className: `text-[11px] font-medium`,
                                                style: {
                                                  color: iconKey ? agentTheme.accentText : agentTheme.textPrimary,
                                                },
                                                children: tr(iconOption.label),
                                              }),
                                            ],
                                          },
                                          iconOption.key,
                                        );
                                      }),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            jsxs(`div`, {
                              className: `rounded-2xl p-4 space-y-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]`,
                              style: {
                                border: `1px solid ${agentTheme.modalBorder}`,
                                background: agentTheme.modalSectionBg,
                                backdropFilter: `blur(16px) saturate(128%)`,
                                WebkitBackdropFilter: `blur(16px) saturate(128%)`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.12)`,
                              },
                              children: [
                                jsxs(`div`, {
                                  className: `flex items-center justify-between gap-3`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-[10px] uppercase tracking-[0.16em]`,
                                      style: {
                                        color: agentTheme.textMuted
                                      },
                                      children: tr(`长期记忆 · Mem0`),
                                    }),
                                    jsxs(`label`, {
                                      className: `inline-flex items-center gap-2 text-[11px] cursor-pointer`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: [
                                        jsx(`input`, {
                                          type: `checkbox`,
                                          checked: !!selectedAgent.memoryEnabled,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              memoryEnabled: event.target.checked,
                                            }),
                                        }),
                                        selectedAgent.memoryEnabled ? tr(`已开启`) : tr(`已关闭`),
                                      ],
                                    }),
                                  ],
                                }),
                                jsxs(`div`, {
                                  className: `grid grid-cols-2 gap-3`,
                                  children: [
                                    jsxs(`label`, {
                                      className: `block`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs mb-2`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: tr(`Mem0 服务地址`),
                                        }),
                                        jsx(`input`, {
                                        value: selectedAgent.memoryBaseUrl || ``,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              memoryBaseUrl: event.target.value,
                                            }),
                                          placeholder: tr(`请输入可选的 Mem0 服务地址`),
                                          className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                          style: {
                                            border: `1px solid ${agentTheme.inputBorder}`,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.inputText,
                                          },
                                        }),
                                      ],
                                    }),
                                    jsxs(`label`, {
                                      className: `block`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs mb-2`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: `API Key`,
                                        }),
                                        jsx(`input`, {
                                          type: `password`,
                                          value: selectedAgent.memoryApiKey || ``,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              memoryApiKey: event.target.value,
                                            }),
                                          placeholder: tr(`AUTH_DISABLED 时可留空`),
                                          className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                          style: {
                                            border: `1px solid ${agentTheme.inputBorder}`,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.inputText,
                                          },
                                        }),
                                      ],
                                    }),
                                    jsxs(`label`, {
                                      className: `block`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs mb-2`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: tr(`用户记忆 ID`),
                                        }),
                                        jsx(`input`, {
                                          value: selectedAgent.memoryUserId || `default-user`,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              memoryUserId: event.target.value,
                                            }),
                                          className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                          style: {
                                            border: `1px solid ${agentTheme.inputBorder}`,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.inputText,
                                          },
                                        }),
                                      ],
                                    }),
                                    jsxs(`label`, {
                                      className: `block`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs mb-2`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: tr(`检索条数`),
                                        }),
                                        jsx(`input`, {
                                          value: selectedAgent.memoryTopK || `6`,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              memoryTopK: event.target.value,
                                            }),
                                          className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                          style: {
                                            border: `1px solid ${agentTheme.inputBorder}`,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.inputText,
                                          },
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                                jsx(`div`, {
                                  className: `text-[11px] leading-5`,
                                  style: {
                                    color: agentTheme.textSecondary
                                  },
                                  children: tr(`开启后，每次发送会先检索相关长期记忆并加入上下文；模型回复成功后，会把本轮对话写入 Mem0。`),
                                }),
                              ],
                            }),
                            jsxs(`div`, {
                              className: `rounded-2xl p-4 space-y-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]`,
                              style: {
                                border: `1px solid ${agentTheme.modalBorder}`,
                                background: agentTheme.modalSectionBg,
                                backdropFilter: `blur(16px) saturate(128%)`,
                                WebkitBackdropFilter: `blur(16px) saturate(128%)`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.12)`,
                              },
                              children: [
                                jsx(`div`, {
                                  className: `text-[10px] uppercase tracking-[0.16em]`,
                                  style: {
                                    color: agentTheme.textMuted
                                  },
                                  children: tr(`模型绑定`),
                                }),
                                jsxs(`label`, {
                                  className: `block`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-xs mb-2`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: tr(`绑定文本模型`),
                                    }),
                                    jsxs(`select`, {
                                      value: selectedAgent.model || ``,
                                      onChange: (event) =>
                                        updateSelectedAgent({
                                          model: event.target.value,
                                        }),
                                      className: `w-full min-w-0 rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                      style: {
                                        border: `1px solid ${agentTheme.inputBorder}`,
                                        background: agentTheme.inputBg,
                                        color: agentTheme.inputText,
                                      },
                                      children: [
                                        jsx(`option`, {
                                          value: ``,
                                          children: tr(`请选择文本模型`),
                                        }),
                                        ...modelOptions.map((modelName) =>
                                          jsx(
                                            `option`, {
                                              value: modelName,
                                              children: modelName
                                            },
                                            modelName,
                                          ),
                                        ),
                                      ],
                                    }),
                                  ],
                                }),
                                jsxs(`label`, {
                                  className: `block`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-xs mb-2`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: tr(`绑定 API 配置`),
                                    }),
                                    jsxs(`select`, {
                                      value: selectedAgent.apiConfigId || ``,
                                      onChange: (event) =>
                                        updateSelectedAgent({
                                          apiConfigId: event.target.value,
                                        }),
                                      className: `w-full min-w-0 rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                      style: {
                                        border: `1px solid ${agentTheme.inputBorder}`,
                                        background: agentTheme.inputBg,
                                        color: agentTheme.inputText,
                                      },
                                      children: [
                                        jsx(`option`, {
                                          value: ``,
                                          children: tr(`未指定（跟随默认文本配置）`),
                                        }),
                                        selectedAgent.apiConfigId&&!apiConfigs.some((item:any)=>item.id===selectedAgent.apiConfigId)&&jsx(`option`,{value:selectedAgent.apiConfigId,disabled:true,children:`${tr('不可用的 API 配置')}: ${selectedAgent.apiConfigId}`}),
                                        ...apiConfigs.map((apiConfig) =>
                                          jsx(
                                            `option`, {
                                              value: apiConfig.id,
                                              children: apiConfig.name || apiConfig.url,
                                            },
                                            apiConfig.id,
                                          ),
                                        ),
                                      ],
                                    }),
                                  ],
                                }),
                                jsxs(`div`, {
                                  className: `grid grid-cols-2 gap-3`,
                                  children: [
                                    jsxs(`label`, {
                                      className: `block`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs mb-2`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: tr(`温度`),
                                        }),
                                        jsx(`input`, {
                                          value: selectedAgent.temperature ?? `0.7`,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              temperature: event.target.value,
                                            }),
                                          className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                          style: {
                                            border: `1px solid ${agentTheme.inputBorder}`,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.inputText,
                                          },
                                        }),
                                      ],
                                    }),
                                    jsxs(`label`, {
                                      className: `block`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs mb-2`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: tr(`默认输出`),
                                        }),
                                        jsxs(`select`, {
                                          value: selectedAgent.outputMode || `chat`,
                                          onChange: (event) =>
                                            updateSelectedAgent({
                                              outputMode: event.target.value,
                                            }),
                                          className: `w-full rounded-xl px-3 py-2 text-sm focus:outline-none`,
                                          style: {
                                            border: `1px solid ${agentTheme.inputBorder}`,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.inputText,
                                          },
                                          children: [
                                            jsx(`option`, {
                                              value: `chat`,
                                              children: tr(`普通对话`),
                                            }),
                                            jsx(`option`, {
                                              value: `prompt`,
                                              children: tr(`提示词`),
                                            }),
                                            jsx(`option`, {
                                              value: `node`,
                                              children: tr(`画布节点草稿`),
                                            }),
                                          ],
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            jsxs(`div`, {
                              className: `rounded-2xl p-4 space-y-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]`,
                              style: {
                                border: `1px solid ${agentTheme.modalBorder}`,
                                background: agentTheme.modalSectionBg,
                                backdropFilter: `blur(16px) saturate(128%)`,
                                WebkitBackdropFilter: `blur(16px) saturate(128%)`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.12)`,
                              },
                              children: [
                                jsx(`div`, {
                                  className: `text-[10px] uppercase tracking-[0.16em]`,
                                  style: {
                                    color: agentTheme.textMuted
                                  },
                                  children: tr(`角色设定`),
                                }),
                                jsxs(`label`, {
                                  className: `block`,
                                  children: [
                                    jsx(`div`, {
                                      className: `text-xs mb-2`,
                                      style: {
                                        color: agentTheme.textSecondary
                                      },
                                      children: tr(`系统提示词`),
                                    }),
                                    jsx(`textarea`, {
                                      value: selectedAgent.systemPrompt || ``,
                                      onChange: (event) =>
                                        updateSelectedAgent({
                                          systemPrompt: event.target.value,
                                        }),
                                      className: `w-full min-h-[150px] resize-y rounded-xl px-3 py-3 text-sm focus:outline-none`,
                                      style: {
                                        border: `1px solid ${agentTheme.inputBorder}`,
                                        background: agentTheme.inputBg,
                                        color: agentTheme.inputText,
                                      },
                                    }),
                                  ],
                                }),
                                jsxs(`label`, {
                                  className: `block`,
                                  children: [
                                    jsxs(`div`, {
                                      className: `mb-2 flex items-center justify-between gap-3`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-xs`,
                                          style: {
                                            color: agentTheme.textSecondary
                                          },
                                          children: tr(`知识库摘要`),
                                        }),
                                        jsx(`button`, {
                                          type: `button`,
                                          onClick: importAgentKnowledgeFile,
                                          'aria-label':tr('导入文件'),
                                          className: `inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] transition-colors`,
                                          style: {
                                            border: `1px solid ${agentTheme.accentBorder}`,
                                            background: agentTheme.accentBg,
                                            color: agentTheme.accentText,
                                          },
                                          children: tr(`导入文件`),
                                        }),
                                      ],
                                    }),
                                    jsx(`textarea`, {
                                      value: selectedAgent.knowledge || ``,
                                      onChange: (event) =>
                                        updateSelectedAgent({
                                          knowledge: event.target.value,
                                        }),
                                      placeholder: tr(`这里先记录角色长期知识、项目资料摘要、风格规范、FAQ 等。后续可以扩展成真正的文件知识库。`),
                                      className: `w-full min-h-[160px] resize-y rounded-xl px-3 py-3 text-sm focus:outline-none`,
                                      style: {
                                        border: `1px solid ${agentTheme.inputBorder}`,
                                        background: agentTheme.inputBg,
                                        color: agentTheme.inputText,
                                      },
                                    }),
                                    jsxs(`div`, {
                                      className: `mt-3 space-y-2`,
                                      children: [
                                        jsx(`div`, {
                                          className: `text-[10px] uppercase tracking-[0.14em]`,
                                          style: {
                                            color: agentTheme.textMuted
                                          },
                                          children: tr(`已导入文件`),
                                        }),
                                        (selectedAgent.knowledgeFiles || []).length > 0 ?
                                        (selectedAgent.knowledgeFiles || []).map((file) =>
                                          jsxs(
                                            `div`, {
                                              className: `flex items-start justify-between gap-3 rounded-xl px-3 py-2`,
                                              style: {
                                                border: `1px solid ${agentTheme.modalBorder}`,
                                                background: agentTheme.modalSectionBg,
                                              },
                                              children: [
                                                jsxs(`div`, {
                                                  className: `min-w-0`,
                                                  children: [
                                                    jsx(`div`, {
                                                      className: `truncate text-[11px] font-medium`,
                                                      style: {
                                                        color: agentTheme.textPrimary
                                                      },
                                                      children: file.name || tr(`未命名文件`),
                                                    }),
                                                    jsxs(`div`, {
                                                      className: `mt-1 text-[10px]`,
                                                      style: {
                                                        color: agentTheme.textSecondary
                                                      },
                                                      children: [
                                                        `${Math.max(1, Math.round((Number(file.size) || 0) / 1024))} KB`,
                                                        file.totalChars ?
                                                        ` · ${roleKnowledgeCount(Number(file.totalChars),'characters',locale)}` :
                                                        ``,
                                                        Array.isArray(file.chunks) ?
                                                        ` · ${roleKnowledgeCount(file.chunks.length,'chunks',locale)}` :
                                                        ``,
                                                        file.importedAt ?
                                                        ` · ${roleKnowledgeTime(file.importedAt,locale)}` :
                                                        ``,
                                                      ],
                                                    }),
                                                    jsx(`div`, {
                                                      className: `mt-2 line-clamp-3 text-[10px] leading-5`,
                                                      style: {
                                                        color: agentTheme.textSecondary
                                                      },
                                                      children: String(file.content || ``).slice(0, 180) ||
                                                        tr(`无可预览内容`),
                                                    }),
                                                  ],
                                                }),
                                                jsx(`button`, {
                                                  type: `button`,
                                                  onClick: () =>
                                                    removeAgentKnowledgeFile(file.id),
                                                  'aria-label':`${tr('移除')}: ${file.name||tr('未命名文件')}`,
                                                  className: `wanjuan-danger-text-action flex-shrink-0 rounded-lg border border-transparent px-2 py-1 text-[10px] text-red-400 hover:text-red-300 hover:border-red-400/24 hover:bg-red-400/10 transition-colors`,
                                                  children: tr(`移除`),
                                                }),
                                              ],
                                            },
                                            file.id,
                                          ),
                                        ) :
                                        jsx(`div`, {
                                          className: `rounded-xl border border-dashed px-3 py-3 text-[11px] leading-5`,
                                          style: {
                                            borderColor: agentTheme.inputBorder,
                                            background: agentTheme.inputBg,
                                            color: agentTheme.textSecondary,
                                          },
                                          children: tr(`支持导入 txt、md、json、csv、rtf、doc、docx、pdf 等常见知识文件。导入后会和上方摘要一起作为智能体知识上下文参与回答。`),
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            jsx(`div`, {
                              className: `rounded-2xl px-4 py-3 text-[11px] leading-6`,
                              style: {
                                border: `1px solid ${agentTheme.accentBorder}`,
                                background: agentTheme.modalSectionBg,
                                backdropFilter: `blur(14px) saturate(122%)`,
                                WebkitBackdropFilter: `blur(14px) saturate(122%)`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
                                color: agentTheme.textSecondary,
                              },
                              children: tr(`底层逻辑保持和文本模型一致：文本模型里新增什么模型，智能体就能直接选什么模型；某个文本模型如果绑定了专属 API 配置，智能体也会优先复用那条关系。`),
                            }),
                          ],
                        }),
                      ],
                    }),
                });
}
