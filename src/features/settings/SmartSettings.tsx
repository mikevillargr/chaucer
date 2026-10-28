import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { confirmDialog, Icon, IconButton, Spinner } from "../../components/ui";
import { api } from "../../lib/ipc";
import { usePrefs, useProviders, useSetPrefs } from "../../lib/queries";
import { useUi } from "../../lib/store";
import type { Provider, ProviderInfo } from "../../lib/types";

const KINDS: { id: Provider["kind"]; name: string; model: string; keyHint: string }[] = [
  { id: "anthropic", name: "Anthropic", model: "claude-sonnet-5-5", keyHint: "sk-ant-…" },
  { id: "openai", name: "OpenAI", model: "gpt-5.1", keyHint: "sk-…" },
  { id: "gemini", name: "Google Gemini", model: "gemini-3-flash", keyHint: "AIza…" },
  { id: "moonshot", name: "Moonshot (Kimi)", model: "kimi-k2.6", keyHint: "sk-… (Kimi Code keys: use model kimi-for-coding)" },
  { id: "openai_compatible", name: "OpenAI-compatible (Ollama, OpenRouter, …)", model: "llama3.3", keyHint: "Optional" },
];

const FEATURES: { id: "smartReply" | "summary" | "write"; name: string; hint: string }[] = [
  { id: "smartReply", name: "Smart Reply", hint: "Suggested quick replies at the end of a conversation" },
  { id: "summary", name: "Summaries", hint: "Summarize long conversations" },
  { id: "write", name: "Help me write", hint: "Draft or rewrite emails in compose" },
];

function ProviderForm({ initial, onDone }: { initial?: ProviderInfo; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [p, setP] = useState<Provider>(initial ?? { id: `p${Date.now().toString(36)}`, name: "Anthropic", kind: "anthropic", model: KINDS[0].model, baseUrl: "" });
  const [key, setKey] = useState("");
  const kind = KINDS.find((k) => k.id === p.kind)!;
  const save = async () => {
    try {
      await api.llmSaveProvider(p, key || undefined);
      await qc.invalidateQueries({ queryKey: ["providers"] });
      onDone();
    } catch (e) {
      toast({ text: String(e), error: true });
    }
  };
  return (
    <div className="card">
      <div className="form-grid">
        <label>Provider</label>
        <select className="input" value={p.kind} disabled={!!initial} onChange={(e) => {
          const k = KINDS.find((x) => x.id === e.target.value)!;
          setP({ ...p, kind: k.id, name: k.name.split(" (")[0], model: k.model });
        }}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <label>Name</label><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        {p.kind === "openai_compatible" && (
          <><label>Base URL</label><input className="input" placeholder="http://localhost:11434/v1" value={p.baseUrl ?? ""} onChange={(e) => setP({ ...p, baseUrl: e.target.value })} /></>
        )}
        <label>Model</label><input className="input" value={p.model} onChange={(e) => setP({ ...p, model: e.target.value })} />
        <label>API key</label>
        <input className="input" type="password" autoComplete="off" placeholder={initial?.hasKey ? "Saved in Keychain — leave blank to keep" : kind.keyHint}
          value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Keys are stored in your macOS Keychain and only sent to the provider you choose. Smart features send the conversation's text to that provider.</p>
      <div className="row-actions">
        <button className="btn filled" onClick={() => void save()} disabled={!p.model.trim() || !p.name.trim()}>Save</button>
        <button className="btn text" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function SmartSettings() {
  const providers = useProviders();
  const prefs = usePrefs();
  const setPrefs = useSetPrefs();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<ProviderInfo | "new" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const list = providers.data ?? [];
  const features = prefs.llmFeatures ?? {};

  const test = async (p: ProviderInfo) => {
    setTesting(p.id);
    try {
      const out = await api.llmTest(p.id);
      toast({ text: `${p.name} responded: ${out.slice(0, 60)}` });
    } catch (e) {
      toast({ text: `${p.name}: ${e}`, error: true });
    } finally {
      setTesting(null);
    }
  };

  return (
    <>
      <h2>Smart features</h2>
      <p className="lead">Bring your own AI provider for Smart Reply, summaries and Help me write. Everything stays off until you choose a provider for a feature.</p>

      <h3 style={{ fontWeight: 500, margin: "8px 0" }}>Providers</h3>
      {list.map((p) => (
        editing !== "new" && editing?.id === p.id ? <ProviderForm key={p.id} initial={p} onDone={() => setEditing(null)} /> : (
          <div className="setting" key={p.id}>
            <Icon name="auto_awesome" className="sparkle" />
            <div className="txt">{p.name}<small>{p.model}{p.baseUrl ? ` · ${p.baseUrl}` : ""}{p.hasKey ? " · key saved" : p.kind === "openai_compatible" ? "" : " · no key"}</small></div>
            <button className="btn text" onClick={() => void test(p)} disabled={testing === p.id}>{testing === p.id ? <Spinner /> : "Test"}</button>
            <IconButton icon="edit" label={`Edit ${p.name}`} onClick={() => setEditing(p)} />
            <IconButton icon="delete" label={`Remove ${p.name}`} onClick={async () => {
              if (!(await confirmDialog(`Remove ${p.name}?`, "Its API key is deleted from your Keychain.", "Remove"))) return;
              await api.llmDeleteProvider(p.id);
              void qc.invalidateQueries({ queryKey: ["providers"] });
            }} />
          </div>
        )
      ))}
      {editing === "new" ? <ProviderForm onDone={() => setEditing(null)} /> : (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setEditing("new")}><Icon name="add" /> Add provider</button>
      )}

      <h3 style={{ fontWeight: 500, margin: "32px 0 8px" }}>Features</h3>
      {FEATURES.map((f) => (
        <div className="setting" key={f.id}>
          <div className="txt">{f.name}<small>{f.hint}</small></div>
          <select value={features[f.id] ?? ""} aria-label={f.name}
            onChange={(e) => setPrefs.mutate({ llmFeatures: { ...features, [f.id]: e.target.value || undefined } })}>
            <option value="">Off</option>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
          </select>
        </div>
      ))}
    </>
  );
}
