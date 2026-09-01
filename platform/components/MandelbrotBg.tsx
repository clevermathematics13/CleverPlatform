"use client";

/** subtle=true renders very low-opacity warm amber blobs with a transparent base,
 *  suitable for layering behind main content without overwhelming it.
 *  Non-subtle renders a rich whiskey/leather/wood atmosphere for sidebars. */
export function MandelbrotBg({ className, subtle }: { className?: string; subtle?: boolean }) {
  return (
    <div
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        backgroundColor: subtle ? "transparent" : "#0f0b0d",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          position: "absolute",
          inset: "-15%",
          background: subtle
            ? /* Subtle coral glows on the charcoal page background */
              "radial-gradient(60rem 40rem at 18% 24%, rgba(224, 64, 95, 0.08), transparent 62%)," +
              "radial-gradient(50rem 38rem at 80% 12%, rgba(242, 122, 144, 0.06), transparent 58%)," +
              "radial-gradient(55rem 44rem at 72% 84%, rgba(200, 16, 63, 0.05), transparent 60%)," +
              "radial-gradient(40rem 34rem at 22% 78%, rgba(150, 90, 110, 0.05), transparent 62%)"
            : /* Deeper coral atmosphere for the sidebar and popups */
              "radial-gradient(45rem 30rem at 18% 24%, rgba(224, 64, 95, 0.30), transparent 62%)," +
              "radial-gradient(38rem 28rem at 80% 12%, rgba(200, 16, 63, 0.24), transparent 58%)," +
              "radial-gradient(42rem 34rem at 72% 84%, rgba(242, 122, 144, 0.18), transparent 60%)," +
              "radial-gradient(30rem 25rem at 22% 78%, rgba(150, 90, 110, 0.22), transparent 62%)," +
              "linear-gradient(160deg, #0f0b0d 0%, #1d1216 55%, #130d10 100%)",
          filter: "saturate(1.1)",
          animation: "warmAmbiance 24s ease-in-out infinite alternate",
          transformOrigin: "50% 50%",
        }}
      />
      {/* Wood grain grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(92deg, transparent, transparent 3px, rgba(224,64,95,0.04) 3px, rgba(224,64,95,0.04) 4px)," +
            "repeating-linear-gradient(185deg, transparent, transparent 55px, rgba(0,0,0,0.06) 55px, rgba(0,0,0,0.06) 56px)",
          mixBlendMode: "soft-light",
          opacity: subtle ? 0.20 : 0.55,
        }}
      />
      {!subtle && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(15, 11, 13, 0.30) 0%, rgba(20, 13, 16, 0.48) 44%, rgba(12, 8, 10, 0.68) 100%)",
          }}
        />
      )}
    </div>
  );
}
