import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";

/**
 * The backdrop the three unauthenticated pages share — sign in, request access,
 * and the "you are in, but the CRM is a separate gate" welcome page.
 *
 * It exists because those three had the same 12 lines of navy-and-gold-wash
 * copied into each of them, and the moment they stopped agreeing the door to the
 * product would have looked like three different products.
 *
 * The field of colour is DARK in both appearances, the same decision and for the
 * same reason as the nav rail: `Wordmark tone="light"` is a reversed mark, and a
 * backdrop that inverted with the OS would need both variants rendered and
 * toggled. The card on top of it is `sf-card`, so the form itself does follow
 * the reader's appearance — which is what makes the transition into the app feel
 * continuous rather than like a second website.
 */
export function AuthShell({
  children,
  /** Rendered outside and below the card, on the gradient. Small print. */
  footer,
  /**
   * `card` puts the children on a raised surface — the sign-in and register
   * forms. `bare` lays them directly on the gradient in reversed type, which is
   * what /welcome wants: it is a message, not a form, and a card around four
   * sentences reads as a dialog demanding an answer.
   */
  variant = "card",
}: {
  children: ReactNode;
  footer?: ReactNode;
  variant?: "card" | "bare";
}) {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      {/* The gradient ground. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(155deg, #16123a 0%, #241a52 45%, #3a1c5c 100%)",
        }}
      />
      {/* Two soft orbs. This is the one piece of pure decoration in the app and
          it is confined to the pages a client never works in. They are blurred
          rather than being real gradients so they stay cheap and never band on
          a wide display. `overflow-hidden` on the section is what keeps them
          from adding a scrollbar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, #6d5bf5 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-32 h-[36rem] w-[36rem] rounded-full opacity-35 blur-3xl"
        style={{ background: "radial-gradient(circle, #d946ef 0%, transparent 65%)" }}
      />

      <div className={`relative w-full ${variant === "card" ? "max-w-md" : "max-w-lg text-center"}`}>
        <div className={variant === "card" ? "mb-8 flex justify-center" : "mb-8 flex justify-center"}>
          <Wordmark tone="light" className="h-11 w-auto" />
        </div>

        {variant === "card" ? (
          <div className="sf-card animate-pop-in rounded-2xl p-8 shadow-pop sm:p-10">{children}</div>
        ) : (
          children
        )}

        {footer ? <div className="mt-6 text-center">{footer}</div> : null}
      </div>
    </section>
  );
}
