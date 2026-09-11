"use client";

/**
 * One MathLive field, wrapped so the rest of the app never touches MathLive.
 *
 * Built imperatively with document.createElement rather than as JSX. MathLive
 * is a custom element, and going through JSX would mean declaring it on
 * React's intrinsic elements and hoping React sets properties rather than
 * attributes for the non-string ones. Creating it by hand sidesteps both, and
 * it cannot render on the server at all -- so the whole module is loaded
 * dynamically by the caller.
 *
 * MathLive ships the same KaTeX woff2 files this app already serves from
 * /katex/fonts, so `fontsDirectory` points there and no font is added to the
 * bundle. Sounds are switched off: a keypress click in a silent classroom is
 * not a feature.
 */

import { useEffect, useRef } from "react";
import type { MathfieldElement } from "mathlive";

let configured = false;

/**
 * Static configuration, applied once per page rather than per field.
 *
 * These are statics on the class, not per-instance options, so setting them
 * inside each field's effect would be thirteen redundant writes and a race on
 * the first paint.
 */
async function loadMathlive(): Promise<typeof MathfieldElement> {
  const mathlive = await import("mathlive");
  const Element = mathlive.MathfieldElement;
  if (!configured) {
    Element.fontsDirectory = "/katex/fonts";
    Element.soundsDirectory = null;
    configured = true;
  }
  return Element;
}

export interface MathAnswerFieldProps {
  value: string;
  onChange: (latex: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Handed the live element so a palette can insert into it. */
  onReady?: (field: MathfieldElement | null) => void;
  readOnly?: boolean;
  ariaLabel: string;
}

export default function MathAnswerField({
  value,
  onChange,
  onFocus,
  onBlur,
  onReady,
  readOnly = false,
  ariaLabel,
}: MathAnswerFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  // Callbacks live in a ref so the mount effect can stay dependency-free: a
  // parent that re-creates its handlers each render must not tear down and
  // rebuild the field, which would lose the cursor mid-keystroke. Refreshed in
  // an effect rather than during render -- the listeners that read it only
  // ever fire after paint, so a render-phase write would buy nothing and
  // break the rule that a render must not touch a ref.
  const handlers = useRef({ onChange, onFocus, onBlur, onReady });
  useEffect(() => {
    handlers.current = { onChange, onFocus, onBlur, onReady };
  });

  useEffect(() => {
    let cancelled = false;
    let created: MathfieldElement | null = null;

    void loadMathlive().then((Element) => {
      if (cancelled || !host.current) return;

      const mf = new Element();
      created = mf;
      field.current = mf;

      // "auto" means MathLive raises its own keyboard on a TOUCH device only.
      // That is deliberate and not a contradiction of the palette: on a phone
      // there is no other way to type a digit, because a math-field is not a
      // real input and the OS keyboard never appears for it. On a desktop the
      // policy is inert and the toggle is hidden in CSS, so the palette is the
      // only notation surface there.
      mf.mathVirtualKeyboardPolicy = "auto";
      mf.smartMode = true;
      mf.value = value;
      mf.readOnly = readOnly;
      mf.setAttribute("aria-label", ariaLabel);
      mf.className = "clev-mathfield";

      mf.addEventListener("input", () => handlers.current.onChange(mf.value));
      mf.addEventListener("focusin", () => handlers.current.onFocus?.());
      mf.addEventListener("focusout", () => handlers.current.onBlur?.());

      host.current.appendChild(mf);

      // Only after it is in the DOM: MathLive throws "Mathfield not mounted"
      // if menuItems is assigned before the element is connected. Its own menu
      // is a second, unorganised route to notation -- "insert matrix",
      // "insert fraction" -- which is exactly the flat list the basic/advanced
      // split exists to avoid.
      mf.menuItems = [];

      handlers.current.onReady?.(mf);
    });

    return () => {
      cancelled = true;
      handlers.current.onReady?.(null);
      created?.remove();
      field.current = null;
    };
    // Mount once. Value and readOnly are pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only write back when the two genuinely differ. Assigning `value` moves the
  // cursor to the end, so echoing the student's own keystroke back into the
  // field would jump the caret on every character they type.
  useEffect(() => {
    const mf = field.current;
    if (mf && mf.value !== value) mf.value = value;
  }, [value]);

  useEffect(() => {
    const mf = field.current;
    if (mf) mf.readOnly = readOnly;
  }, [readOnly]);

  return <div ref={host} className="clev-mathfield-host" />;
}
