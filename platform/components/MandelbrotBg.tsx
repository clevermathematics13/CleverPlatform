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
        backgroundColor: subtle ? "transparent" : "#160905",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          position: "absolute",
          inset: "-15%",
          background: subtle
            ? /* Subtle warm whiskey glows — parchment page background */
              "radial-gradient(60rem 40rem at 18% 24%, rgba(200, 138, 26, 0.09), transparent 62%)," +
              "radial-gradient(50rem 38rem at 80% 12%, rgba(232, 160, 48, 0.07), transparent 58%)," +
              "radial-gradient(55rem 44rem at 72% 84%, rgba(180, 100, 30, 0.06), transparent 60%)," +
              "radial-gradient(40rem 34rem at 22% 78%, rgba(155, 117, 85, 0.05), transparent 62%)"
            : /* Rich whiskey atmosphere — sidebar & popups */
              "radial-gradient(45rem 30rem at 18% 24%, rgba(200, 138, 26, 0.38), transparent 62%)," +
              "radial-gradient(38rem 28rem at 80% 12%, rgba(180, 90, 20, 0.30), transparent 58%)," +
              "radial-gradient(42rem 34rem at 72% 84%, rgba(232, 160, 48, 0.22), transparent 60%)," +
              "radial-gradient(30rem 25rem at 22% 78%, rgba(155, 100, 50, 0.26), transparent 62%)," +
              "linear-gradient(160deg, #160905 0%, #2a1208 55%, #1c0c06 100%)",
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
            "repeating-linear-gradient(92deg, transparent, transparent 3px, rgba(200,138,26,0.04) 3px, rgba(200,138,26,0.04) 4px)," +
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
              "linear-gradient(180deg, rgba(22, 9, 5, 0.30) 0%, rgba(26, 12, 6, 0.48) 44%, rgba(18, 8, 3, 0.68) 100%)",
          }}
        />
      )}
    </div>
  );
}
