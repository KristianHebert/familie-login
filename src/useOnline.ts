import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * useSyncExternalStore er Reacts måde at læse tilstand, der bor uden for React
 * - her browserens netværksstatus. Den sikrer, at vi ikke render en forældet
 * værdi, og rydder selv op efter sig.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
