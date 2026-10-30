import { useEffect } from "react";
import { isEditingText } from "../labels";

export interface ShortcutHandlers {
  addChild?: () => void;
  toggleFrontier?: () => void;
  open?: () => void;
  remove?: () => void;
  escape?: () => void;
  deeper?: () => void;
  shallower?: () => void;
}

/** Single-key graph shortcuts; ignored while typing in a field. */
export function useGraphShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditingText(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const action: Record<string, (() => void) | undefined> = {
        n: handlers.addChild,
        f: handlers.toggleFrontier,
        Enter: handlers.open,
        Delete: handlers.remove,
        Backspace: handlers.remove,
        Escape: handlers.escape,
        "]": handlers.deeper,
        "[": handlers.shallower,
      };
      const run = action[e.key];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
