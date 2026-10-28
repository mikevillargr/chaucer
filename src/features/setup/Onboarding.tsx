import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Icon, Spinner } from "../../components/ui";
import { api, native } from "../../lib/ipc";
import { refreshMail } from "../../lib/queries";

const CONSOLE = "https://console.cloud.google.com/apis/credentials";

/** First run: connect a Google Cloud OAuth client, then sign in to the first account. */
export function Onboarding({ hasClient }: { hasClient: boolean }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveClient = async () => {
    setError(null);
    try {
      await api.setGoogleClient(clientId, secret);
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (e) {
      setError(String(e));
    }
  };

  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.addAccount();
      refreshMail(qc);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard drag" data-tauri-drag-region>
      <div className="onboard-card">
        <img className="app-mark" src="/icon.svg" alt="" />
        {!hasClient ? (
          <>
            <h1>Connect Letterbox to Google</h1>
            <p className="muted">Letterbox talks to Gmail with your own Google Cloud OAuth client, so your mail never passes through anyone else's servers. One-time setup, about 5 minutes:</p>
            <ol>
              <li>In Google Cloud, create a project and enable the <b>Gmail API</b> and <b>People API</b>.</li>
              <li>Configure the OAuth consent screen (External), add yourself, then <b>publish it</b> so sign-ins don't expire weekly.</li>
              <li>Create an OAuth client ID of type <b>Desktop app</b> and paste its ID and secret below.</li>
            </ol>
            <button className="btn text" style={{ paddingLeft: 0 }} onClick={() => void native.openUrl(CONSOLE)}>
              <Icon name="open_in_new" /> Open Google Cloud Console
            </button>
            <div className="form-grid">
              <label htmlFor="cid">Client ID</label>
              <input id="cid" className="input" placeholder="…apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              <label htmlFor="csecret">Client secret</label>
              <input id="csecret" className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
            <button className="btn filled" disabled={!clientId.trim() || !secret.trim()} onClick={() => void saveClient()}>Continue</button>
          </>
        ) : (
          <>
            <h1>Sign in to Gmail</h1>
            <p className="muted">Your browser will open to Google's sign-in page. Because the app is unverified, Google shows a warning the first time — choose <b>Advanced → Go to Letterbox</b>. You can add more accounts later in Settings.</p>
            <button className="btn filled" onClick={() => void signIn()} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="login" />} {busy ? "Waiting for your browser…" : "Sign in with Google"}
            </button>
          </>
        )}
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  );
}
