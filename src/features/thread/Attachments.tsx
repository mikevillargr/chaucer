import { useEffect, useState } from "react";
import { Icon, IconButton, Spinner } from "../../components/ui";
import { bytes } from "../../lib/format";
import { api, native } from "../../lib/ipc";
import { useUi } from "../../lib/store";
import type { Attachment } from "../../lib/types";

const iconFor = (mime: string) =>
  mime.startsWith("image/") ? "image" : mime === "application/pdf" ? "picture_as_pdf" : mime.startsWith("video/") ? "movie"
    : mime.startsWith("audio/") ? "audio_file" : mime.includes("sheet") || mime.includes("excel") || mime === "text/csv" ? "table"
    : mime.includes("presentation") || mime.includes("powerpoint") ? "slideshow" : mime.includes("zip") ? "folder_zip" : "description";

const previewable = (mime: string) => mime.startsWith("image/") || mime === "application/pdf";

export function useAttachmentActions(accountId: string, messageId: string) {
  const toast = useUi((s) => s.toast);
  return {
    async download(a: Attachment) {
      const path = await native.savePath(a.filename);
      if (!path) return;
      try {
        await api.saveAttachment(accountId, messageId, a.attachmentId, path);
        toast({ text: `Saved ${a.filename}` });
      } catch (e) {
        toast({ text: String(e), error: true });
      }
    },
    async open(a: Attachment) {
      try {
        await api.openAttachment(accountId, messageId, a.attachmentId, a.filename);
      } catch (e) {
        toast({ text: String(e), error: true });
      }
    },
  };
}

export function Attachments({ accountId, messageId, items }: { accountId: string; messageId: string; items: Attachment[] }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const actions = useAttachmentActions(accountId, messageId);
  const shown = items.filter((a) => !a.inline);
  if (!shown.length) return null;
  return (
    <>
      <div className="attachments">
        {shown.map((a) => (
          <div
            key={a.attachmentId}
            className="attachment"
            title={a.filename}
            onDoubleClick={() => (previewable(a.mimeType) ? setPreview(a) : void actions.open(a))}
          >
            <Icon name={iconFor(a.mimeType)} className="sparkle" />
            <div style={{ minWidth: 0 }} onClick={() => (previewable(a.mimeType) ? setPreview(a) : void actions.open(a))}>
              <div className="fname">{a.filename}</div>
              <div className="fsize">{bytes(a.size)}</div>
            </div>
            <IconButton small icon="download" label="Download" onClick={() => void actions.download(a)} />
          </div>
        ))}
      </div>
      {preview && (
        <Lightbox accountId={accountId} messageId={messageId} attachment={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

function Lightbox({ accountId, messageId, attachment, onClose }: {
  accountId: string; messageId: string; attachment: Attachment; onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useAttachmentActions(accountId, messageId);

  useEffect(() => {
    let blobUrl: string | null = null;
    api.attachmentData(accountId, messageId, attachment.attachmentId)
      .then((b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        blobUrl = URL.createObjectURL(new Blob([bin], { type: attachment.mimeType }));
        setUrl(blobUrl);
      })
      .catch((e) => setError(String(e)));
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [accountId, messageId, attachment, onClose]);

  return (
    <div className="lightbox" role="dialog" aria-label={attachment.filename}>
      <div className="lightbox-bar drag" data-tauri-drag-region>
        <Icon name={iconFor(attachment.mimeType)} />
        <span style={{ flex: 1 }}>{attachment.filename}</span>
        <IconButton icon="open_in_new" label="Open in default app" onClick={() => void actions.open(attachment)} />
        <IconButton icon="download" label="Download" onClick={() => void actions.download(attachment)} />
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className="lightbox-body" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {error ? <span style={{ color: "#fff" }}>{error}</span>
          : !url ? <Spinner />
          : attachment.mimeType === "application/pdf" ? <iframe src={url} title={attachment.filename} />
          : <img src={url} alt={attachment.filename} />}
      </div>
    </div>
  );
}
