"use client";

/**
 * Pasting, dropping and picking images into a Markdown text field.
 *
 * One control, three surfaces: the card description, the comment box and the AI
 * chat. They differ in what they do with the result, not in how the image gets
 * there, so this owns the upload and the call site owns the text.
 *
 * **Paste is the primary path and everything else is a fallback.** The thing
 * people actually do is take a screenshot and press ⌘V; a button that opens a
 * file picker is what you use when the image is already a file. Both are here,
 * plus drag-and-drop, and all three end in the same `upload()`.
 *
 * **The Markdown is inserted at the CURSOR, not appended.** Someone typing "the
 * total is wrong here:" and pasting expects the image after that sentence, and
 * an append would be indistinguishable from a bug the moment there are two
 * images. Selection is replaced, the way a paste of text would.
 *
 * **Uploading blocks nothing.** The field stays editable while a large paste is
 * in flight, so the sentence you were half-way through does not stall. The
 * consequence is that the insertion point is captured at paste time and the
 * text is re-read at insert time — see `insertAt`.
 */

import { useCallback, useRef, useState } from "react";
import { apiUpload } from "./api";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentMarkdown,
  fmtBytes,
  isAllowedImageType,
} from "@/lib/crm/attachments";

export interface UploadedAttachment {
  id: string;
  url: string;
  file_name: string | null;
  content_type: string;
  byte_size: number;
}

/**
 * Splice `text` into `value` at `at`, replacing `through`.
 *
 * Free function and pure, because the caller's `value` may have moved on since
 * the upload started — this is called with whatever the field holds NOW, and
 * the offsets are clamped to it rather than trusted.
 */
function insertAt(value: string, at: number, through: number, text: string): {
  next: string;
  caret: number;
} {
  const start = Math.max(0, Math.min(at, value.length));
  const end = Math.max(start, Math.min(through, value.length));
  // A blank line before and after, so an image is its own block. Without it a
  // paste onto the end of a sentence produces `text ![](url)`, which Markdown
  // renders as an inline image sitting inside the paragraph.
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const tail = after.startsWith("\n") ? "" : "\n";
  const block = `${lead}${text}${tail}`;
  return { next: `${before}${block}${after}`, caret: start + block.length };
}

/** Images out of a paste or a drop, ignoring everything else on the clipboard. */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => f.type.startsWith("image/"));
}

export function useAttachImages({
  value,
  onChange,
  fieldRef,
  onUploaded,
}: {
  /** Current text of the field. Read at insert time, never cached. */
  value: string;
  onChange: (next: string) => void;
  fieldRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Also told about each upload, for callers that track ids separately. */
  onUploaded?: (row: UploadedAttachment) => void;
}) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Depth counter, not a boolean. dragenter/dragleave fire for every child the
  // pointer crosses, so a boolean flickers off the moment the cursor moves from
  // the textarea onto its own placeholder text.
  const dragDepth = useRef(0);
  // Read at insert time so a value that changed mid-upload is not clobbered.
  const latest = useRef(value);
  latest.current = value;

  const upload = useCallback(
    async (files: File[], at: number, through: number) => {
      const usable: File[] = [];
      for (const file of files) {
        if (!isAllowedImageType(file.type)) {
          setError(
            `${file.name || "That file"} is ${file.type || "an unknown type"}. Images only: ${ALLOWED_IMAGE_TYPES.map((t) => t.replace("image/", "")).join(", ")}.`,
          );
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(
            `${file.name || "That image"} is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_ATTACHMENT_BYTES)}.`,
          );
          continue;
        }
        usable.push(file);
      }
      if (!usable.length) return;

      setUploading((n) => n + usable.length);
      // Sequential, not Promise.all. Each insertion depends on where the last
      // one left the caret, and three concurrent uploads resolving in any order
      // would interleave their Markdown at three stale offsets.
      let cursor = at;
      let replacing = through;
      for (const file of usable) {
        try {
          const form = new FormData();
          form.append("file", file);
          const row = await apiUpload<UploadedAttachment>("/api/crm/attachments", form);
          const { next, caret } = insertAt(
            latest.current,
            cursor,
            replacing,
            attachmentMarkdown(row.file_name || "image", row.id),
          );
          latest.current = next;
          onChange(next);
          onUploaded?.(row);
          cursor = caret;
          replacing = caret;
          // Put the caret after what was just inserted, so typing continues
          // where the person was rather than jumping to the end of the field.
          queueMicrotask(() => {
            const el = fieldRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(caret, caret);
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "That image could not be uploaded.");
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }
    },
    [fieldRef, onChange, onUploaded],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = imageFilesFrom(event.clipboardData);
      if (!files.length) return; // A normal text paste. Leave it entirely alone.
      event.preventDefault();
      const el = event.currentTarget;
      void upload(files, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length);
    },
    [upload],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      const files = imageFilesFrom(event.dataTransfer);
      dragDepth.current = 0;
      setDragging(false);
      if (!files.length) return;
      event.preventDefault();
      const el = event.currentTarget;
      // A drop has no caret of its own — the browser does not move the
      // insertion point for a file drop — so it lands at the end.
      const end = el.value.length;
      void upload(files, end, end);
    },
    [upload],
  );

  const dragProps = {
    onDragEnter: (event: React.DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      // Without preventDefault the browser navigates to the dropped file, which
      // throws away whatever was being written.
      event.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
  };

  /** For the button: open a picker and upload at the current caret. */
  const pick = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const el = fieldRef.current;
      const at = el?.selectionStart ?? latest.current.length;
      const through = el?.selectionEnd ?? at;
      void upload([...files], at, through);
    },
    [fieldRef, upload],
  );

  return {
    onPaste,
    onDrop,
    dragProps,
    pick,
    dragging,
    uploading,
    error,
    clearError: () => setError(""),
  };
}

/**
 * The button, and the hint that tells people paste works at all.
 *
 * The hint earns its line: paste-to-upload is invisible, and a feature nobody
 * knows about is one nobody uses. It is the quietest thing in the row.
 */
export function AttachButton({
  onPick,
  uploading,
  label = "Attach image",
}: {
  onPick: (files: FileList | null) => void;
  uploading: number;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          // Reset, or picking the SAME file twice in a row fires no change
          // event the second time and the button appears dead.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="sf-btn-ghost text-xs"
        disabled={uploading > 0}
        title="Attach an image — or just paste one"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 16l4.5-4.5a2 2 0 012.8 0L16 16m-2-2l1.5-1.5a2 2 0 012.8 0L20 14M4 5h16v14H4z" />
        </svg>
        {uploading > 0 ? `Uploading ${uploading}…` : label}
      </button>
    </>
  );
}
