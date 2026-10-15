/**
 * Google Identity Services.
 *
 * Hvorfor den her findes ved siden af Firebases eget login:
 *
 * Firebases signInWithRedirect lægger sin tilstand i sessionStorage og sender
 * browseren til /__/auth/handler og videre til Google. sessionStorage hører til
 * ÉN fane. Browserudvidelser, der åbner Google-domæner i en separat container -
 * Multi-Account Containers og lignende - genåbner accounts.google.com i en NY
 * fane, og så er tilstanden væk, når brugeren kommer tilbage. Resultatet er
 * "Unable to process request due to missing initial state", og det kan ikke
 * rettes i appen: man kan ikke bære sessionStorage med over i en anden fane.
 *
 * GIS undgår problemet ved ikke at have det: Google leverer et id-token direkte
 * i siden, og vi veksler det til en Firebase-session med signInWithCredential.
 * Ingen top-niveau-navigation, ingen handler, ingen sessionStorage.
 *
 * Det er ikke en garanti. Googles kontovælger åbner stadig et popup-vindue, og
 * en tilpas aggressiv udvidelse kan gribe ind i det. Derfor står Firebases
 * oprindelige login stadig som reserve - ingen skal kunne låses ude.
 */

import { EMULATOR } from "./emulator";

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

interface CredentialResponse {
  credential?: string;
  error?: string;
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "small" | "medium" | "large";
      text?: "signin_with" | "signup_with" | "continue_with";
      shape?: "rectangular" | "pill" | "circle" | "square";
      locale?: string;
      width?: number;
    },
  ): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
  interface ImportMetaEnv {
    /** Fra .env.local i repoets rod; byggetjekket i ../vite.js kræver den. */
    readonly VITE_GOOGLE_CLIENT_ID?: string;
  }
}

/*
 * Mod emulatoren er GIS slået fra. Knappen taler med det rigtige Google og
 * ville give et rigtigt id-token til et opdigtet projekt; emulatoren har sit
 * eget login-vindue, som Firebases almindelige login bruger af sig selv.
 */
export const GOOGLE_CLIENT_ID = EMULATOR ? "" : (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "");

/** Uden et klient-id kan GIS ikke bruges, og vi falder tilbage til Firebase. */
export const isGisConfigured = Boolean(GOOGLE_CLIENT_ID);

/**
 * Skal vi overhovedet forsøge GIS?
 *
 * Googles knap ligger i en iframe fra accounts.google.com og har brug for
 * tredjepartslagring. Firefox og Safari blokerer den som standard, så GIS er
 * upålidelig dér - knappen kan tegnes, uden at login nogensinde gennemføres.
 *
 * I de browsere går vi direkte til Firebases eget redirect-login, som er
 * afprøvet og virker. GIS er en forbedring for Chromium-browsere, ikke en
 * erstatning, der skal presses ned over alle.
 */
export function shouldTryGis(): boolean {
  if (!isGisConfigured) return false;
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return false;
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return false;
  return true;
}

let loader: Promise<GoogleIdApi> | null = null;

function loadGis(): Promise<GoogleIdApi> {
  const ready = window.google?.accounts?.id;
  if (ready) return Promise.resolve(ready);

  loader ??= new Promise<GoogleIdApi>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Googles login-script svarede ikke")),
      10_000,
    );
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      clearTimeout(timeout);
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error("Googles login-script indlæste, men mangler accounts.id"));
    };
    script.onerror = () => {
      clearTimeout(timeout);
      loader = null; // så et nyt forsøg kan hente scriptet igen
      reject(new Error("Kunne ikke hente Googles login-script"));
    };
    document.head.append(script);
  });

  return loader;
}

/**
 * Tegner Googles egen login-knap i `parent` og kalder `onCredential` med
 * id-tokenet, når brugeren har valgt konto.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  onCredential: (idToken: string) => void,
  onError: (message: string) => void,
): Promise<void> {
  if (!isGisConfigured) throw new Error("VITE_GOOGLE_CLIENT_ID mangler");

  const api = await loadGis();
  api.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => {
      if (response.credential) onCredential(response.credential);
      else onError("Google sendte intet id-token tilbage.");
    },
    ux_mode: "popup",
    // Ingen automatisk genlogin: flere i familien deler måske maskine, og
    // det skal være tydeligt, hvem man logger ind som.
    auto_select: false,
    itp_support: true,
  });

  parent.replaceChildren();
  api.renderButton(parent, {
    type: "standard",
    theme: "filled_blue",
    size: "large",
    text: "signin_with",
    shape: "pill",
    locale: "da",
    width: 280,
  });
}
