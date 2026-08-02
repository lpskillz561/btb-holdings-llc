// Shown instantly while any /crm page renders on the server.
//
// Without this the CRM looked broken rather than slow: next/link calls
// preventDefault() and navigates client-side, which suppresses the browser's
// own loading indicator, so a slow server render is indistinguishable from a
// dead link. A route-level loading state is the App Router's answer — it paints
// on the first frame after the click, before the server has done any work.
//
// It covers /crm and everything under it, so the client card and proposal pages
// get the same treatment for free.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-navy-900/10 ${className}`} />;
}

export default function CrmLoading() {
  return (
    <>
      <section className="bg-navy-950">
        <div className="container-x py-10 lg:py-14">
          <div className="h-3 w-32 animate-pulse rounded bg-white/15" />
          <div className="mt-5 h-9 w-72 animate-pulse rounded bg-white/15" />
          <div className="mt-4 h-4 w-full max-w-xl animate-pulse rounded bg-white/10" />
          <div className="mt-8 flex gap-2 border-t border-white/10 pt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 w-24 animate-pulse rounded-md bg-white/10" />
            ))}
          </div>
        </div>
      </section>

      <section className="section pt-12">
        <div className="container-x space-y-10">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-5">
                <Bar className="h-3 w-24" />
                <Bar className="mt-3 h-7 w-28" />
                <Bar className="mt-2 h-3 w-32" />
              </div>
            ))}
          </div>

          <div className="card p-6">
            <Bar className="h-4 w-28" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Bar key={i} className="h-9 w-full" />
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
