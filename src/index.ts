/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/*
 * Det, familiens apps deler.
 *
 * Pakken bygges ikke for sig: appen importerer kildekoden, og appens egen
 * Vite oversætter den. Derfor kan den bruge import.meta.env og det virtuelle
 * modul fra vite-plugin-pwa, som appen stiller til rådighed.
 *
 * Login er det, der har kostet mest - GIS, Firefox og container-udvidelser -
 * og det er derfor, det ligger her: en ny app skal arve det, ikke kopiere det.
 */
export {
  lavLogin,
  normalizeEmail,
  type AuthApi,
  type AuthState,
  type GoogleKonto,
  type Opslag,
} from "./login";
export type { AppOplysninger } from "./adgang";
export { db, isFirebaseConfigured } from "./firebase";
export { AppUpdateProvider, useAppUpdate } from "./appUpdate";
export { useOnline } from "./useOnline";
