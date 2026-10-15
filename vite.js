/*
 * Byggetjekket, som hver app sætter først i sin vite.config.ts.
 *
 * Almindelig JavaScript med vilje: Vite lader Node selv indlæse de pakker,
 * vite.config.ts importerer, og Node 22.13 læser ikke TypeScript af sig selv.
 * Typerne står i vite.d.ts ved siden af.
 */

/**
 * Nøglerne, pakken læser i src/firebase.ts og src/gis.ts. De står også i
 * .env.example i repoets rod og som secrets i GitHub.
 */
export const NOEGLER = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_GOOGLE_CLIENT_ID",
];

/*
 * Den form, hver nøgle har hos Google og Firebase.
 *
 * En nøgle, der er skåret af, bygger fint og ser rigtig ud, men den virker
 * ikke. Det skete 5. okt. 2026: secret'en VITE_GOOGLE_CLIENT_ID i GitHub
 * manglede sine sidste 14 tegn. Appen blev udgivet med den, og Google-knappen
 * gav "invalid_client" til alle, indtil nogen prøvede den. Ingen af nøglerne
 * indeholder blanktegn, så et linjeskift med i en kopi bliver også fanget her.
 */
const FORM = {
  VITE_FIREBASE_API_KEY: /^AIza[\w-]{35}$/,
  VITE_FIREBASE_AUTH_DOMAIN: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
  VITE_FIREBASE_PROJECT_ID: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  VITE_FIREBASE_APP_ID: /^1:\d+:web:[0-9a-f]+$/,
  VITE_GOOGLE_CLIENT_ID: /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
};

/*
 * Uden nøglerne bygger appen stadig - men i lokal tilstand, uden database og
 * login (isFirebaseConfigured i src/firebase.ts). Det er meningen under
 * udvikling, men et byg, der bliver udgivet, ville give familien en tom app,
 * hvor alt kun gemmes på den enkelte telefon. Og det sker let: .env.local er
 * ikke i git og skal flyttes i hånden til hver maskine. Derfor stopper et
 * produktionsbyg her - også når en nøgle er der, men ikke har sin form.
 *
 * config.env er Vites egen udgave af miljøet, altså præcis det, der bages ind.
 * Værdierne skrives ikke ud i fejlen; den nævner kun nøglernes navne.
 */
export function kraevNoegler() {
  return {
    name: "kraev-noegler",
    apply: "build",
    configResolved(config) {
      const mangler = NOEGLER.filter((k) => !config.env[k]);
      if (mangler.length > 0) {
        throw new Error(
          `Mangler ${mangler.join(", ")} i ${config.envDir}/.env.local.\n` +
            "Kopiér .env.example i repoets rod til .env.local og udfyld den. Uden nøglerne " +
            "bygges appen i lokal tilstand, uden database og login, og den må ikke udgives.",
        );
      }
      const forkerte = NOEGLER.filter((k) => !FORM[k].test(config.env[k]));
      if (forkerte.length > 0) {
        throw new Error(
          `${forkerte.join(", ")} har ikke den form, nøglen skal have. Er den skåret af, ` +
            "eller kom et mellemrum eller linjeskift med, da den blev sat ind?\n" +
            `Ret den i ${config.envDir}/.env.local - eller i GitHubs secrets, hvis bygget ` +
            "kører dér. Se .env.example.",
        );
      }
    },
  };
}
