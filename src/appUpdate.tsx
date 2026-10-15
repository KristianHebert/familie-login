import { createContext, use, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

interface AppUpdate {
  /** Der ligger en ny version klar, som venter på at blive taget i brug. */
  ready: boolean;
  /** Skift til den nye version. Siden genindlæser. */
  apply: () => void;
}

const Ctx = createContext<AppUpdate>({ ready: false, apply: () => {} });

/**
 * Holder styr på, om der ligger en ny version klar.
 *
 * Registreringen skal ske ét sted og tidligt - også på loginskærmen, hvor der
 * ikke er nogen topbjælke - mens visningen hører hjemme i bjælken. Derfor en
 * provider frem for en komponent, der både registrerer og tegner.
 *
 * Browseren spørger kun efter en ny service worker, når siden NAVIGERER. En app
 * på hjemmeskærmen genoptages fra baggrunden uden navigation, og så bliver der
 * aldrig spurgt. Derfor spørger vi selv, hver gang appen kommer frem.
 */
export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      regRef.current = registration ?? null;
    },
  });

  useEffect(() => {
    const tjek = async () => {
      const reg = regRef.current;
      if (!reg || document.hidden) return;
      try {
        await reg.update();
      } catch {
        // Offline eller serveren svarer ikke - vi prøver igen næste gang.
      }
      // En version, der allerede ventede, udløser ingen ny hændelse. Kig
      // derfor på `waiting` frem for kun at lytte.
      if (reg.waiting) setNeedRefresh(true);
    };

    document.addEventListener("visibilitychange", tjek);
    const timer = setInterval(tjek, 60 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", tjek);
      clearInterval(timer);
    };
  }, [setNeedRefresh]);

  const vaerdi = useMemo<AppUpdate>(
    () => ({ ready: needRefresh, apply: () => void updateServiceWorker(true) }),
    [needRefresh, updateServiceWorker],
  );

  return <Ctx value={vaerdi}>{children}</Ctx>;
}

export function useAppUpdate(): AppUpdate {
  return use(Ctx);
}
