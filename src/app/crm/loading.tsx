// Shown instantly while any /crm page renders on the server.
//
// Without this the CRM looked broken rather than slow: next/link calls
// preventDefault() and navigates client-side, which suppresses the browser's
// own loading indicator, so a slow server render is indistinguishable from a
// dead link.
//
// It MUST mirror the real chrome in CrmNav exactly — same bar heights, same
// paddings, same number of tabs. When it did not, every navigation painted the
// old tall hero and then collapsed into the compact header, which read as the
// header "expanding" on each click. A skeleton whose geometry disagrees with the
// page is worse than none: it introduces the layout shift it exists to prevent.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-ink-200 ${className}`} />;
}

export default function CrmLoading() {
  return (
    <>
      {/* Global header — h-12, matching CrmNav. */}
      <div className="bg-navy-950">
        <div className="container-x flex h-12 items-center justify-between">
          <div className="h-4 w-32 animate-pulse rounded bg-white/15" />
          <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
        </div>
      </div>

      {/* Object nav — six tabs, py-2.5. */}
      <div className="border-b border-ink-200 bg-white">
        <div className="container-x flex gap-6 py-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-4 w-20" />
          ))}
        </div>
      </div>

      {/* Record header — same min-height as the real one, so nothing moves. */}
      <div className="border-b border-ink-200 bg-white">
        <div className="container-x min-h-[9.25rem] py-4">
          <Bar className="h-3 w-28" />
          <div className="mt-2 flex items-start gap-3">
            <div className="mt-0.5 hidden h-10 w-10 shrink-0 animate-pulse rounded bg-ink-200 sm:block" />
            <div className="min-w-0 flex-1">
              <Bar className="h-3 w-24" />
              <Bar className="mt-1.5 h-6 w-56" />
              <Bar className="mt-2 h-4 w-full max-w-xl" />
            </div>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container-x space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="sf-card p-4">
                <Bar className="h-3 w-24" />
                <Bar className="mt-2 h-7 w-24" />
                <Bar className="mt-2 h-3 w-28" />
              </div>
            ))}
          </div>
          <div className="sf-card p-4">
            <Bar className="h-4 w-28" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Bar key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <span className="sr-only" role="status">
        Loading…
      </span>
    </>
  );
}
