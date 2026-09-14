"use client";

import { useState } from "react";

/** Copia un texto al portapapeles y lo confirma en el botón. */
export function CopyButton({ text, label = "copiar", className = "copy-btn" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  }
  return (
    <button type="button" className={`${className} ${done ? "copied" : ""}`} onClick={copy}>
      {done ? "copiado ✓" : label}
    </button>
  );
}
