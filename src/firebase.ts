import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from "firebase/firestore";
import { EMULATOR, EMULATOR_AUTH, EMULATOR_FIRESTORE } from "./emulator";

/*
 * Nøglerne fra .env.local i repoets rod. Byggetjekket i ../vite.js har den
 * samme liste og stopper et produktionsbyg, hvis en af dem mangler.
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY?: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
    readonly VITE_FIREBASE_PROJECT_ID?: string;
    readonly VITE_FIREBASE_APP_ID?: string;
  }
}

/**
 * Login-iframen skal køre på samme origin som appen. På elbilapp.web.app
 * fejler Firefox (og ofte Safari) med "missing initial state", hvis
 * authDomain stadig er elbilapp.firebaseapp.com — browseren isolerer
 * lagring på tværs af de to domæner.
 */
function authDomain(): string {
  const fromEnv = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  if (typeof window === "undefined") return fromEnv ?? "";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return fromEnv ?? host;
  return host;
}

/*
 * Mod emulatoren bruges et demo-projekt, aldrig det rigtige. Et projekt-id,
 * der begynder med "demo-", kan ikke nå rigtige tjenester. Og fordi både
 * projekt-id og nøgle er nogle andre, lægger browseren login og lokal kopi
 * for sig - ellers kunne en kø af uafsendte skrivninger fra emulatoren blive
 * sendt til det rigtige projekt, eller omvendt (faldgrube 7).
 */
const DEMO = {
  apiKey: "demo-noegle",
  authDomain: "demo-familieapps.firebaseapp.com",
  projectId: "demo-familieapps",
  appId: "demo",
};

const config = EMULATOR
  ? DEMO
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: authDomain(),
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

/**
 * Uden .env.local kører appen i lokal tilstand med data i browseren.
 * Så kan man udvikle og se UI'et uden et Firebase-projekt.
 */
export const isFirebaseConfigured = Boolean(
  config.apiKey && config.projectId && config.authDomain && config.appId,
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase er ikke konfigureret - mangler VITE_FIREBASE_* i .env.local");
  }
  app ??= initializeApp({
    apiKey: config.apiKey!,
    authDomain: config.authDomain!,
    projectId: config.projectId!,
    appId: config.appId!,
  });
  return app;
}

export function auth(): Auth {
  /*
   * Bevidst standard-getAuth i stedet for initializeAuth med egen
   * lagringsrækkefølge.
   *
   * Der stod tidligere `persistence: [indexedDBLocalPersistence,
   * browserLocalPersistence]`. Den liste udelader sessionStorage, og det er
   * dér, Firebase lægger den markør, redirect-login skal finde igen, når
   * Google sender brugeren tilbage. Chrome klarede sig alligevel; Firefox
   * fejlede med "Unable to process request due to missing initial state".
   *
   * getAuth bruger kæden indexedDB -> localStorage -> sessionStorage og den
   * almindelige resolver. Det er den vej, der er trådt flest gange - og vi
   * havde aldrig en grund til at afvige fra den.
   */
  if (!authInstance) {
    authInstance = getAuth(ensureApp());
    // Firebase viser selv et banner nederst på siden, når login går til
    // emulatoren, så ingen tror, de er i den rigtige app.
    if (EMULATOR) connectAuthEmulator(authInstance, EMULATOR_AUTH);
  }
  return authInstance;
}

/**
 * Smid appens lokale kopi af databasen væk og hent siden forfra.
 *
 * Firestores lager rummer to ting: en cache, som bare kan hentes igen, og en
 * kø af skrivninger, der endnu ikke er sendt. Går lageret i stykker - eller
 * sætter køen sig fast - fejler enhver forespørgsel med `unavailable`, og
 * enheden kan ikke komme videre ved egen kraft. Det overlever genstart, fordi
 * det ligger i IndexedDB.
 *
 * Prisen er, at uafsendte skrivninger går tabt. Det er med vilje: står man på
 * fejlskærmen, kommer de alligevel aldrig af sted, og en fastlåst kø er
 * desuden farlig - den bærer hele dokumenter med sig og kan rulle andres
 * rettelser tilbage, hvis den pludselig skyller igennem.
 */
export async function ryddLokaleData(): Promise<void> {
  if (dbInstance) {
    // Lageret kan ikke ryddes, mens klienten har det åbent.
    await terminate(dbInstance);
    await clearIndexedDbPersistence(dbInstance);
    dbInstance = null;
  }
}

export function db(): Firestore {
  if (dbInstance) return dbInstance;
  const app = ensureApp();
  try {
    // Persistent cache: appen virker offline og viser sidste kendte data med det
    // samme, mens den synkroniserer i baggrunden. Det er grunden til, at vi ikke
    // selv skal skrive cache-logik.
    /*
     * Bevidst uden experimentalForceLongPolling. Den blev prøvet 21. sep. 2026
     * mod et udfald, hvor Firestore ikke kunne nås, og hjalp ikke - hverken
     * alene eller med kort svarfrist. Se faldgruben i CLAUDE.md, før den
     * findes frem igen.
     */
    dbInstance = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    if (EMULATOR) {
      connectFirestoreEmulator(dbInstance, EMULATOR_FIRESTORE.host, EMULATOR_FIRESTORE.port);
    }
  } catch {
    dbInstance = getFirestore(app);
  }
  return dbInstance;
}
