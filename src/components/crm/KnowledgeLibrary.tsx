"use client";

/**
 * The knowledge library — everything the assistant has been given to read.
 *
 * Two lists, and the split IS the feature: what the assistant knows everywhere,
 * and what it has merely read. A single list sorted by date would hide the one
 * fact that matters about any row here, which is whether it is in the prompt of
 * every proposal, advisor answer and meeting summary in the app.
 *
 * The chat room has the same actions on a compact card (`DocumentCard`). This
 * page is where someone reads the note BEFORE adopting it, which is the whole
 * reason adoption is a separate step from reading — see lib/crm/knowledge-docs.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiUpload } from "./api";
import { DocumentCard } from "./DocumentCard";
import { EmptyState, ErrorNote } from "./ui";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_KINDS_SENTENCE,
  MAX_DOCUMENT_BYTES,
  fmtDocumentBytes,
  isDocumentFile,
  type CrmDocumentSummary,
} from "@/lib/crm/documents";

export function KnowledgeLibrary({ initial }: { initial: CrmDocumentSummary[] }) {
  const [documents, setDocuments] = useState(initial);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const replace = useCallback((next: CrmDocumentSummary) => {
    setDocuments((rows) => rows.map((r) => (r.id === next.id ? next : r)));
  }, []);

  /**
   * The same live stream the chat room listens to.
   *
   * A document is read in the background, so without this the page would sit at
   * "waiting to be read" until someone reloaded — and the natural thing to do
   * after uploading a 90-page memorandum is to watch. `document` events are not
   * channel-scoped, which is why this page can subscribe to a chat stream and
   * get exactly the events it wants and none of the messages.
   */
  useEffect(() => {
    const source = new EventSource("/api/crm/chat/stream");
    source.addEventListener("document", (e) => {
      const { document: row } = JSON.parse(e.data) as { document: CrmDocumentSummary };
      setDocuments((rows) =>
        rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows],
      );
    });
    return () => source.close();
  }, []);

  const upload = useCallback(async (files: File[]) => {
    const usable = files.filter((f) => {
      if (!isDocumentFile(f.name, f.type)) {
        setError(
          `${f.name || "That file"} can't be read. ${DOCUMENT_KINDS_SENTENCE}. (An old .doc has to be saved as .docx first.)`,
        );
        return false;
      }
      if (f.size > MAX_DOCUMENT_BYTES) {
        setError(
          `${f.name} is ${fmtDocumentBytes(f.size)}. The limit is ${fmtDocumentBytes(MAX_DOCUMENT_BYTES)}.`,
        );
        return false;
      }
      return true;
    });
    if (!usable.length) return;

    setUploading((n) => n + usable.length);
    // Concurrent here, unlike the chat composer's sequential loop: nothing
    // depends on the order because there is no caret to keep — each upload just
    // prepends a row.
    await Promise.all(
      usable.map(async (file) => {
        try {
          const form = new FormData();
          form.append("file", file);
          const row = await apiUpload<CrmDocumentSummary>("/api/crm/documents", form);
          setDocuments((rows) => (rows.some((r) => r.id === row.id) ? rows : [row, ...rows]));
        } catch (err) {
          setError(err instanceof Error ? err.message : `${file.name} could not be uploaded.`);
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }),
    );
  }, []);

  async function remove(row: CrmDocumentSummary) {
    if (
      !confirm(
        row.active_at
          ? `Delete "${row.title}"? The assistant is using this — deleting it removes it from what the assistant knows, everywhere.`
          : `Delete "${row.title}"? The file and the assistant's note on it both go.`,
      )
    ) {
      return;
    }
    const before = documents;
    setDocuments((rows) => rows.filter((r) => r.id !== row.id));
    try {
      await apiDelete(`/api/crm/documents/${row.id}`);
    } catch (err) {
      setDocuments(before);
      setError(err instanceof Error ? err.message : "That document could not be deleted.");
    }
  }

  async function refresh() {
    try {
      const { documents: rows } = await apiGet<{ documents: CrmDocumentSummary[] }>(
        "/api/crm/documents",
      );
      setDocuments(rows);
    } catch {
      // The list on screen is still the list. Not worth a message.
    }
  }

  const adopted = documents.filter((d) => d.active_at);
  const rest = documents.filter((d) => !d.active_at);

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* ---- the drop zone ---- */}
      <div
        onDragEnter={(e) => {
          if (!e.dataTransfer?.types.includes("Files")) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types.includes("Files")) return;
          // Without preventDefault the browser navigates to the dropped file,
          // which throws the page away.
          e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void upload([...e.dataTransfer.files]);
        }}
        className={`rounded-card border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-sf-400 bg-sf-50" : "border-ink-300 bg-card-2"
        }`}
      >
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            // Reset, or picking the SAME file twice fires no change event the
            // second time and the button appears dead.
            e.target.value = "";
          }}
        />
        <p className="text-sm font-medium text-ink-900">
          Drop a document here, or{" "}
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="text-sf-600 underline underline-offset-2 hover:text-sf-700"
          >
            choose a file
          </button>
          .
        </p>
        <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-ink-600">
          {DOCUMENT_KINDS_SENTENCE}, up to {fmtDocumentBytes(MAX_DOCUMENT_BYTES)}. The assistant
          reads it and writes a note; you decide whether that note becomes part of what it knows.
          Scans and photographs of paper will not work — there is no OCR here.
        </p>
        {uploading > 0 && (
          <p className="mt-3 text-xs font-medium text-sf-700">
            Uploading {uploading}… reading starts as soon as each one lands.
          </p>
        )}
      </div>

      {/* ---- in the knowledge base ---- */}
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-700">
            What the assistant knows
          </h2>
          <span className="sf-num text-xs text-ink-500">{adopted.length}</span>
        </div>
        <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-600">
          These notes are in the assistant&rsquo;s prompt on every AI surface in the app — proposal
          drafting, the client advisor, meeting summaries and the chat room. They sit{" "}
          <em>under</em> the house knowledge base: where one of these disagrees with what BTB
          actually does, the house view wins and the assistant is told to say so.
        </p>
        {adopted.length === 0 ? (
          <EmptyState>
            Nothing has been adopted yet. The assistant is working from the house knowledge base
            alone, which is the correct default — adopt a document below when you want it to know
            that document everywhere.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {adopted.map((row) => (
              <Row key={row.id} row={row} onChange={replace} onDelete={remove} />
            ))}
          </div>
        )}
      </section>

      {/* ---- read, not adopted ---- */}
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-700">
            Uploaded, not adopted
          </h2>
          <span className="sf-num text-xs text-ink-500">{rest.length}</span>
          <button type="button" onClick={() => void refresh()} className="sf-btn-ghost ml-auto text-xs">
            Refresh
          </button>
        </div>
        <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-600">
          Read but not taught. The assistant will still work from any of these when someone attaches
          it to a chat message — that is a transient read of a document in front of it, which is a
          different thing from knowing it.
        </p>
        {rest.length === 0 ? (
          <EmptyState>Nothing waiting. Everything uploaded has been adopted or deleted.</EmptyState>
        ) : (
          <div className="space-y-2">
            {rest.map((row) => (
              <Row key={row.id} row={row} onChange={replace} onDelete={remove} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One document: the shared card, plus the things only this page offers. */
function Row({
  row,
  onChange,
  onDelete,
}: {
  row: CrmDocumentSummary;
  onChange: (next: CrmDocumentSummary) => void;
  onDelete: (row: CrmDocumentSummary) => void;
}) {
  return (
    <div className="sf-card p-3">
      {/* `compact={false}`, so the card also offers Download. The card itself is
          the same component the chat room renders — one place to change what
          adopting a document looks like, and one place to get it wrong. */}
      <DocumentCard document={row} onChange={onChange} />
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-ink-200 pt-2 text-[0.7rem] text-ink-500">
        {row.uploaded_by && <span>Uploaded by {row.uploaded_by.split("@")[0]}</span>}
        {row.activated_by && <span>Adopted by {row.activated_by.split("@")[0]}</span>}
        {row.file_name && <span className="truncate">{row.file_name}</span>}
        <button
          type="button"
          onClick={() => onDelete(row)}
          className="ml-auto rounded-pill px-2 py-0.5 font-medium text-ink-500 transition hover:bg-err-50 hover:text-err-700"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
