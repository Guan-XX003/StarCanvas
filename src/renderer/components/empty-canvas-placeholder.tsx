/** 空画布占位提示（无节点时显示）。自 WanJuanAppCanvas 抽出，props 传入，行为不变。 */
import { jsx, jsxs } from "react/jsx-runtime";
import { Image, Music2, Type, Video, Workflow } from "lucide-react";
declare const chrome: any;

export function WanJuanEmptyCanvasPlaceholder({
  createNodeAt,
  screenToFlowPosition,
  wrapperRef,
}: any) {
  return jsx(`div`, {
              className: `wanjuan-empty-canvas-placeholder absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none`,
              children: jsxs(`div`, {
                className: `flex flex-col items-center pointer-events-auto -translate-y-10`,
                style: {
                  transform: `translateY(-18px)`
                },
                children: [
                  jsxs(`div`, {
                    className: `wanjuan-empty-canvas-title bg-[#1c1c1c] px-5 py-2.5 flex items-center gap-3 mb-10 border border-[#333]`,
                    style: {
                      display: `flex`,
                      alignItems: `center`,
                      gap: 12,
                      minHeight: 44,
                      marginBottom: 34,
                      padding: `10px 22px`,
                      borderRadius: 6,
                    },
                    children: [
                      jsx(Workflow, {
                        size: 18,
                        strokeWidth: 1.8,
                        "aria-hidden": `true`,
                        className: `text-gray-300`,
                        style: {
                          display: `block`,
                          flex: `0 0 18px`
                        },
                      }),
                      jsx(`span`, {
                        className: `text-base font-medium text-gray-200 tracking-wide`,
                        style: {
                          lineHeight: `22px`
                        },
                        children: `创建节点，展开你的想象`,
                      }),
                    ],
                  }),
                  jsxs(`div`, {
                    className: `flex items-center gap-4`,
                    style: {
                      display: `flex`,
                      alignItems: `center`,
                      gap: 16
                    },
                    children: [
                      jsxs(`button`, {
                        onClick: () => {
                          let rect = wrapperRef.current?.getBoundingClientRect();
                          createNodeAt(
                            `textNode`,
                            rect ? screenToFlowPosition({
                              x: rect.left + rect.width / 2 - 150,
                              y: rect.top + rect.height / 2,
                            }) : {
                              x: 0,
                              y: 0
                            }, {
                              text: ``
                            },
                          );
                        },
                        className: `wanjuan-empty-canvas-action flex items-center gap-2 px-6 py-3.5 bg-transparent hover:bg-[#222] border border-[#333] hover:border-gray-500 transition-all text-gray-400 hover:text-gray-200`,
                        style: {
                          display: `inline-flex`,
                          alignItems: `center`,
                          justifyContent: `center`,
                          gap: 8,
                          height: 36,
                          minWidth: 124,
                          padding: `0 18px`,
                          borderRadius: 4,
                          lineHeight: 1,
                          overflow: `hidden`,
                        },
                        children: [
                          jsx(Type, {
                            className: `text-gray-500`,
                            size: 16,
                            strokeWidth: 1.8,
                            "aria-hidden": `true`,
                            style: {
                              display: `inline-flex`,
                              flex: `0 0 16px`,
                            },
                          }),
                          jsx(`span`, {
                            className: `text-sm font-medium`,
                            style: {
                              lineHeight: `18px`
                            },
                            children: `文字生成`,
                          }),
                        ],
                      }),
                      jsxs(`button`, {
                        onClick: () => {
                          let rect = wrapperRef.current?.getBoundingClientRect();
                          createNodeAt(
                            `promptNode`,
                            rect ? screenToFlowPosition({
                              x: rect.left + rect.width / 2,
                              y: rect.top + rect.height / 2,
                            }) : {
                              x: 0,
                              y: 0
                            }, {
                              prompt: ``
                            },
                          );
                        },
                        className: `wanjuan-empty-canvas-action flex items-center gap-2 px-6 py-3.5 bg-transparent hover:bg-[#222] border border-[#333] hover:border-gray-500 transition-all text-gray-400 hover:text-gray-200`,
                        style: {
                          display: `inline-flex`,
                          alignItems: `center`,
                          justifyContent: `center`,
                          gap: 8,
                          height: 36,
                          minWidth: 124,
                          padding: `0 18px`,
                          borderRadius: 4,
                          lineHeight: 1,
                          overflow: `hidden`,
                        },
                        children: [
                          jsx(Image, {
                            size: 16,
                            strokeWidth: 1.8,
                            "aria-hidden": `true`,
                            className: `text-gray-500`,
                            style: {
                              display: `block`,
                              flex: `0 0 16px`
                            },
                          }),
                          jsx(`span`, {
                            className: `text-sm font-medium`,
                            style: {
                              lineHeight: `18px`
                            },
                            children: `图片生成`,
                          }),
                        ],
                      }),
                      jsxs(`button`, {
                        onClick: () => {
                          let rect = wrapperRef.current?.getBoundingClientRect();
                          createNodeAt(
                            `videoNode`,
                            rect ? screenToFlowPosition({
                              x: rect.left + rect.width / 2 + 150,
                              y: rect.top + rect.height / 2,
                            }) : {
                              x: 0,
                              y: 0
                            }, {
                              prompt: ``
                            },
                          );
                        },
                        className: `wanjuan-empty-canvas-action flex items-center gap-2 px-6 py-3.5 bg-transparent hover:bg-[#222] border border-[#333] hover:border-gray-500 transition-all text-gray-400 hover:text-gray-200`,
                        style: {
                          display: `inline-flex`,
                          alignItems: `center`,
                          justifyContent: `center`,
                          gap: 8,
                          height: 36,
                          minWidth: 124,
                          padding: `0 18px`,
                          borderRadius: 4,
                          lineHeight: 1,
                          overflow: `hidden`,
                        },
                        children: [
                          jsx(Video, {
                            size: 16,
                            strokeWidth: 1.8,
                            "aria-hidden": `true`,
                            className: `text-gray-500`,
                            style: {
                              display: `block`,
                              flex: `0 0 16px`
                            },
                          }),
                          jsx(`span`, {
                            className: `text-sm font-medium`,
                            style: {
                              lineHeight: `18px`
                            },
                            children: `视频生成`,
                          }),
                        ],
                      }),
                      jsxs(`button`, {
                        onClick: () => {
                          let rect = wrapperRef.current?.getBoundingClientRect();
                          createNodeAt(
                            `musicNode`,
                            rect ? screenToFlowPosition({
                              x: rect.left + rect.width / 2 + 300,
                              y: rect.top + rect.height / 2,
                            }) : {
                              x: 0,
                              y: 0
                            }, {
                              mode: `suno`,
                              nodeKind: `music`,
                              prompt: ``
                            },
                          );
                        },
                        className: `wanjuan-empty-canvas-action flex items-center gap-2 px-6 py-3.5 bg-transparent hover:bg-[#222] border border-[#333] hover:border-gray-500 transition-all text-gray-400 hover:text-gray-200`,
                        style: {
                          display: `inline-flex`,
                          alignItems: `center`,
                          justifyContent: `center`,
                          gap: 8,
                          height: 36,
                          minWidth: 124,
                          padding: `0 18px`,
                          borderRadius: 4,
                          lineHeight: 1,
                          overflow: `hidden`,
                        },
                        children: [
                          jsx(Music2, {
                            className: `text-gray-500`,
                            size: 16,
                            strokeWidth: 1.8,
                            "aria-hidden": `true`,
                            style: {
                              display: `inline-flex`,
                              flex: `0 0 16px`,
                            },
                          }),
                          jsx(`span`, {
                            className: `text-sm font-medium`,
                            style: {
                              lineHeight: `18px`
                            },
                            children: `音乐生成`,
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            });
}
