"use client";

/**
 * Pasting, dropping and picking files into a Markdown text field.
 *
 * One control, several surfaces: the card description, the comment box, the AI
 * panel and the chat room. They differ in what they do with the result, not in
 * how the file gets there, so this owns the upload and the call site owns the
 * text.
 *
 * **Paste is the primary path and everything else is a fallback.** The thing
 * people actually do is take a screenshot and press ⌘V; a button that opens a
 * file picker is what you use when the file is already a file. Both are here,
 * plus drag-and-drop, and all three end in the same `upload()`.
 *
 * **The Markdown is inserted at the CURSOR, not appended.** Someone typing "the
 * total is wrong here:" and pasting expects the image after that sentence, and
 * an append would be indistinguishable from a bug the moment there are two.
 * Selection is replaced, the way a paste of text would.
 *
 * **Uploading blocks nothing.** The field stays editable while a large paste is
 * in flight, so the sentence you were half-way through does not stall. The
 * consequence is that the insertion point is captured at paste time and the
 * text is re-read at insert time — see `insertAt`.
 *
 * ## Two kinds of file, one path
 *
 * An IMAGE goes to `/api/crm/attachments` and becomes `![alt](…)`. A DOCUMENT —
 * PDF, .docx, text — goes to `/api/crm/documents`, becomes a LINK, and is read
 * by the assistant in the background. Which one a file is, is decided per file
 * inside `upload()`, so a person dragging a screenshot and a PDF together gets
 * the right thing for each without choosing anything.
 *
 * Documents are OPT-IN per call site (`documents: true`), and that matters: on a
 * card description or a comment, a dropped PDF would previously have been
 * ignored, and turning it into a silent upload-and-learn everywhere would put a
 * counterparty's file into the assistant's reading queue from a surface that
 * never advertised it. The chat room asks for them; the others do not, yet.
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
import {
  DOCUMENT_ACCEPT,
  MAX_DOCUMENT_BYTES,
  documentMarkdown,
  fmtDocumentBytes,
  isDocumentFile,
} from "@/lib/crm/documents";
import type { DocumentStatus } from "@/lib/crm/types";

export interface UploadedAttachment {
  id: string;
  url: string;
  file_name: string | null;
  content_type: string;
  byte_size: number;
}

export interface UploadedDocument {
  id: string;
  url: string;
  title: string;
  file_name: string | null;
  content_type: string;
  byte_size: number;
  status: DocumentStatus;
  active_at: string | null;
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

/**
 * The files worth taking off a paste or a drop.
 *
 * Images by MIME prefix; documents by NAME as well as MIME, because a browser's
 * `File.type` for a `.md` is routinely `""` and for a `.csv` is whatever the OS
 * last associated with Excel. Anything else is left alone entirely — a dropped
 * .zip should behave as it always has, which is to say the browser's business
 * and not ours.
 */
function usefulFilesFrom(data: DataTransfer | null, documents: boolean): File[] {
  if (!data) return [];
  return [...data.files].filter(
    (f) => f.type.startsWith("image/") || (documents && isDocumentFile(f.name, f.type)),
  );
}

export function useAttachFiles({
  value,
  onChange,
  fieldRef,
  onUploaded,
  onDocument,
  documents = false,
}: {
  /** Current text of the field. Read at insert time, never cached. */
  value: string;
  onChange: (next: string) => void;
  fieldRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Also told about each image, for callers that track ids separately. */
  onUploaded?: (row: UploadedAttachment) => void;
  /** Told about each document, so a card can appear before the read finishes. */
  onDocument?: (row: UploadedDocument) => void;
  /** Accept PDFs and Word files as well as images. Off by default — see above. */
  documents?: boolean;
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
      const usable: { file: File; kind: "image" | "document" }[] = [];
      for (const file of files) {
        // The IMAGE test runs first, and that order is deliberate rather than
        // arbitrary: nothing is both, but a file that is neither should be
        // reported against the wider of the two allow-lists when documents are
        // on, because "images only" is a confusing thing to be told about a PDF.
        if (isAllowedImageType(file.type)) {
          if (file.size > MAX_ATTACHMENT_BYTES) {
            setError(
              `${file.name || "That image"} is ${fmtBytes(file.size)}. The limit for images is ${fmtBytes(MAX_ATTACHMENT_BYTES)}.`,
            );
            continue;
          }
          usable.push({ file, kind: "image" });
          continue;
        }
        if (documents && isDocumentFile(file.name, file.type)) {
          if (file.size > MAX_DOCUMENT_BYTES) {
            setError(
              `${file.name || "That document"} is ${fmtDocumentBytes(file.size)}. The limit for documents is ${fmtDocumentBytes(MAX_DOCUMENT_BYTES)}.`,
            );
            continue;
          }
          usable.push({ file, kind: "document" });
          continue;
        }
        setError(
          documents
            ? `${file.name || "That file"} can't be attached. Images, PDFs, Word .docx, plain text, Markdown or CSV. (An old .doc has to be saved as .docx first.)`
            : `${file.name || "That file"} is ${file.type || "an unknown type"}. Images only: ${ALLOWED_IMAGE_TYPES.map((t) => t.replace("image/", "")).join(", ")}.`,
        );
      }
      if (!usable.length) return;

      setUploading((n) => n + usable.length);
      // Sequential, not Promise.all. Each insertion depends on where the last
      // one left the caret, and three concurrent uploads resolving in any order
      // would interleave their Markdown at three stale offsets.
      let cursor = at;
      let replacing = through;
      for (const { file, kind } of usable) {
        try {
          const form = new FormData();
          form.append("file", file);

          let markdown: string;
          if (kind === "image") {
            const row = await apiUpload<UploadedAttachment>("/api/crm/attachments", form);
            markdown = attachmentMarkdown(row.file_name || "image", row.id);
            onUploaded?.(row);
          } else {
            const row = await apiUpload<UploadedDocument>("/api/crm/documents", form);
            markdown = documentMarkdown(row.title || row.file_name || "document", row.id);
            onDocument?.(row);
          }

          const { next, caret } = insertAt(latest.current, cursor, replacing, markdown);
          latest.current = next;
          onChange(next);
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
          setError(
            err instanceof Error
              ? err.message
              : `${file.name || "That file"} could not be uploaded.`,
          );
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }
    },
    [documents, fieldRef, onChange, onDocument, onUploaded],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = usefulFilesFrom(event.clipboardData, documents);
      if (!files.length) return; // A normal text paste. Leave it entirely alone.
      event.preventDefault();
      const el = event.currentTarget;
      void upload(files, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length);
    },
    [documents, upload],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      const files = usefulFilesFrom(event.dataTransfer, documents);
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
    [documents, upload],
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
 *
 * ONE button for both kinds, where the surface takes both. Two — "Image" and
 * "Document" — would make people choose a category before choosing a file, when
 * the file already knows which it is; the picker's own `accept` list is what
 * does the filtering, and `upload()` routes what comes back.
 */
export function AttachButton({
  onPick,
  uploading,
  label = "Attach image",
  documents = false,
}: {
  onPick: (files: FileList | null) => void;
  uploading: number;
  label?: string;
  /** Offer PDFs and Word files as well. Matches the hook's own option. */
  documents?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={
          documents
            ? `${ALLOWED_IMAGE_TYPES.join(",")},${DOCUMENT_ACCEPT}`
            : ALLOWED_IMAGE_TYPES.join(",")
        }
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
        title={
          documents
            ? "Attach an image or a document — or just paste one"
            : "Attach an image — or just paste one"
        }
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
          {documents ? (
            // A paperclip, because the button now means "attach a file" rather
            // than "attach a picture", and a photo glyph over a PDF picker is a
            // small lie that costs someone a confused click.
            <path d="M21 10.5l-8.8 8.8a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-8.9 8.9a1.7 1.7 0 01-2.4-2.4l8.2-8.2" />
          ) : (
            <path d="M4 16l4.5-4.5a2 2 0 012.8 0L16 16m-2-2l1.5-1.5a2 2 0 012.8 0L20 14M4 5h16v14H4z" />
          )}
        </svg>
        {uploading > 0 ? `Uploading ${uploading}…` : label}
      </button>
    </>
  );
}
