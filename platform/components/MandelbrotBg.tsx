"use client";

/** subtle=true renders very low-opacity gradient blobs with a transparent base,
 *  suitable for layering behind main content without overwhelming it. */
export function MandelbrotBg({ className, subtle }: { className?: string; subtle?: boolean }) {
  return (
    <div
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        backgroundColor: subtle ? "transparent" : "#0b1020",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          position: "absolute",
          inset: "-15%",
          background: subtle
            ? "radial-gradient(60rem 40rem at 18% 24%, rgba(244, 180, 96, 0.09), transparent 62%)," +
              "radial-gradient(50rem 38rem at 80% 12%, rgba(98, 194, 168, 0.10), transparent 58%)," +
              "radial-gradient(55rem 44rem at 72% 84%, rgba(95, 145, 225, 0.08), transparent 60%)," +
              "radial-gradient(40rem 34rem at 22% 78%, rgba(222, 118, 167, 0.07), transparent 62%)"
            : "radial-gradient(45rem 30rem at 18% 24%, rgba(244, 180, 96, 0.32), transparent 62%)," +
              "radial-gradient(38rem 28rem at 80% 12%, rgba(98, 194, 168, 0.34), transparent 58%)," +
              "radial-gradient(42rem 34rem at 72% 84%, rgba(95, 145, 225, 0.26), transparent 60%)," +
              "radial-gradient(30rem 25rem at 22% 78%, rgba(222, 118, 167, 0.24), transparent 62%)," +
              "linear-gradient(160deg, #0b1020 0%, #111a33 55%, #0d1730 100%)",
          filter: "saturate(1.06)",
          animation: "menuPsychedelicDrift 24s ease-in-out infinite alternate",
          transformOrigin: "50% 50%",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          mixBlendMode: "soft-light",
          opacity: subtle ? 0.15 : 0.42,
        }}
      />
      {!subtle && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(9, 14, 27, 0.34) 0%, rgba(10, 16, 31, 0.52) 44%, rgba(8, 12, 24, 0.7) 100%)",
          }}
        />
      )}
    </div>
  );
}
