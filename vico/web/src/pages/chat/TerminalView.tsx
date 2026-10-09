'use client';

import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

/** 终端浅色主题 — 白底深字，贴合管理后台的明亮风格 */
const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#24292e',
  cursor: '#24292e',
  cursorAccent: '#ffffff',
  selectionBackground: '#b3d4fc',
  black: '#24292e',
  red: '#d73a49',
  green: '#22863a',
  yellow: '#b08800',
  blue: '#0366d6',
  magenta: '#6f42c1',
  cyan: '#1b7c83',
  white: '#d1d5da',
  brightBlack: '#586069',
  brightRed: '#d73a49',
  brightGreen: '#22863a',
  brightYellow: '#b08800',
  brightBlue: '#0366d6',
  brightMagenta: '#6f42c1',
  brightCyan: '#1b7c83',
  brightWhite: '#f6f8fa',
};

/**
 * Web 终端视图 — 右侧边栏单个「终端」tab 的内容。
 *
 * 基于 xterm 渲染，通过 WebSocket 连接后端 pty（每个终端由 `terminalId` 区分）：
 * - 用户输入 → ws 发送原始字符串；xterm 尺寸变化 → ws 发送 `{"type":"resize",cols,rows}`
 * - 后端 pty 输出 → ws 消息 → term.write 渲染
 *
 * 所有终端视图在面板内同时挂载、CSS 切换可见性，因此 xterm 实例只在挂载时创建一次；
 * WebSocket 延迟到首次激活该 tab 时才建立，避免未使用终端也派生 shell 进程。
 */
export function TerminalView({
  threadId,
  terminalId,
  active,
}: {
  threadId: string;
  terminalId: string;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // 创建 xterm 实例（仅一次），并绑定输入/尺寸事件
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: LIGHT_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    // 用户键入 → 发送给后端 pty
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // 尺寸变化（含 fit 触发）→ 同步给后端 pty
    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      fit.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [threadId, terminalId]);

  // 激活时：首次建立 WS 连接，或从隐藏恢复时重新 fit
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    if (!wsRef.current) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/api/v1/threads/${threadId}/terminal/${terminalId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          term.write(ev.data);
        } else if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        } else if (ev.data instanceof Blob) {
          void ev.data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        term.write('\r\n[终端已断开]\r\n');
      };
      // 连接成功后 fit，让 xterm 拿到正确尺寸并触发 resize 消息
      ws.onopen = () => {
        requestAnimationFrame(() => {
          try {
            fit.fit();
          } catch { /* 容器不可见时忽略 */ }
        });
      };
    } else {
      // 从隐藏恢复 → 重新校准尺寸
      requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch { /* ignore */ }
      });
    }
    term.focus();
  }, [active, threadId, terminalId]);

  return <div ref={containerRef} className="min-h-0 flex-1" />;
}
