/**
 * Kører appen mod Firebase-emulatoren i stedet for det rigtige projekt?
 *
 * Kun under udvikling og kun med `vite --mode emulator`
 * (`npm run dev:emulator`). I et produktionsbyg er udtrykket falsk allerede,
 * når der bygges, så koden bag det kommer slet ikke med i det udgivne.
 */
export const EMULATOR = import.meta.env.DEV && import.meta.env.MODE === "emulator";

/** Samme porte som under "emulators" i firebase.json. */
export const EMULATOR_AUTH = "http://127.0.0.1:9099";
export const EMULATOR_FIRESTORE = { host: "127.0.0.1", port: 8080 };
