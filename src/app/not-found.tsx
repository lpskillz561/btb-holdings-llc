import Link from "next/link";

export default function NotFound() {
  return (
    <section className="bg-navy-950 text-paper-50">
      <div className="container-x flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
        <p className="eyebrow-light justify-center">Error 404</p>
        <h1 className="mt-5 font-serif text-5xl">This page isn&apos;t on record.</h1>
        <p className="mt-4 max-w-md text-paper-50/60">
          The page you&apos;re looking for may have moved or never existed. Let&apos;s
          get you back to solid ground.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/" className="btn-gold">
            Return home
          </Link>
          <Link href="/contact" className="btn-ghost-light">
            Contact us
          </Link>
        </div>
      </div>
    </section>
  );
}
