"use client";

import { useState, useRef, useEffect } from "react";
import { X, Send, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { chatApi } from "@/lib/api";
import { useSettings } from "@/store/queries";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  sceneId: number;
  onClose: () => void;
}

export function ChatPanel({ sceneId, onClose }: Props) {
  const { data: settings } = useSettings();
  const { t } = useLanguage();
  const enabledModels: string[] = settings?.enabled_models?.length
    ? settings.enabled_models
    : settings?.default_model ? [settings.default_model] : [];

  // "" means "use default"; once the user picks explicitly, we store their choice
  const [selectedModel, setSelectedModel] = useState("");
  const effectiveModel = selectedModel || settings?.default_chat_model || settings?.default_model || "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const setLastAssistantContent = (content: string) =>
    setMessages((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = { role: "assistant", content };
      return updated;
    });

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const outgoing: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await chatApi.stream(sceneId, outgoing, effectiveModel || undefined);
      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const json = JSON.parse(data);
            // Surface backend/OpenRouter errors that arrive inside the SSE stream
            if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: updated[updated.length - 1].content + delta,
                };
                return updated;
              });
            }
          } catch (inner: any) {
            // Re-throw so the outer catch can show it
            throw inner;
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setLastAssistantContent(`Error: ${e.message ?? t("common_generation_failed")}`);
      }
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col w-80 border-l border-border bg-card h-full shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <MessageSquare className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium shrink-0">{t("cmd_chat_label")}</span>
        <div className="flex-1 min-w-0">
          {enabledModels.length > 0 && (
            <select
              value={effectiveModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-background text-xs rounded border border-border px-1.5 py-1 outline-none truncate"
              disabled={loading}
            >
              {enabledModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setMessages([])}
              title={t("chat_clear_conversation")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 pb-8">
            <MessageSquare className="h-8 w-8 opacity-20" />
            <p className="text-xs leading-relaxed">
              {t("chat_empty_hint")}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex flex-col gap-0.5", msg.role === "user" && "items-end")}>
            <span className="text-[10px] text-muted-foreground px-1">
              {msg.role === "user" ? t("chat_role_you") : t("scene_ai_short")}
            </span>
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-xs leading-relaxed max-w-[90%] whitespace-pre-wrap break-words",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {msg.content || (loading && i === messages.length - 1 && (
                <span className="flex gap-1 items-center h-4">
                  {[0, 1, 2].map((j) => (
                    <span
                      key={j}
                      className="w-1 h-1 rounded-full bg-current opacity-60 animate-bounce"
                      style={{ animationDelay: `${j * 0.15}s` }}
                    />
                  ))}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          className="text-xs resize-none flex-1 min-h-[60px]"
          placeholder={t("chat_input_placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={loading}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          variant={loading ? "outline" : "default"}
          onClick={loading ? stop : send}
          title={loading ? t("chat_stop") : t("dm_send")}
        >
          {loading
            ? <span className="w-2.5 h-2.5 rounded-sm bg-current" />
            : <Send className="h-3.5 w-3.5" />
          }
        </Button>
      </div>
    </div>
  );
}
