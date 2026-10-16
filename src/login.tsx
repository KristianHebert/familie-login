import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "./firebase";
import { EMULATOR } from "./emulator";
import { Port, type AppOplysninger } from "./adgang";

/**
 * Den indloggede, som Google kender dem - renset, før appen får dem at se.
 *
 * Alle apps får det samme, så "navnet kommer fra Google-kontoen, ét sted"
 * gælder for dem alle, og e-mailen er normaliseret på samme måde overalt.
 */
export interface GoogleKonto {
  uid: string;
  /** Normaliseret med normalizeEmail, så den kan bruges som nøgle. */
  email: string;
  /** Fra Google-kontoen; e-mailens første del, hvis kontoen intet navn har. */
  name: string;
}

export type AuthState<S> =
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  /** Logget ind hos Google, men appens opslag svarede nej. */
  | { status: "denied"; email: string }
  /**
   * Logget ind hos Google, men vi kunne ikke slå brugeren op i databasen.
   *
   * Det er ikke det samme som afvist, og det er hele pointen med at holde de
   * to adskilt: "du har ikke adgang" er en påstand om personen, og den må vi
   * kun fremsætte, når vi faktisk har spurgt databasen og fået nej.
   */
  | {
      status: "unresolved";
      email: string;
      message: string;
      /** Firestores egen fejlkode, fx "unavailable". Vises i det små. */
      code: string;
      /** Fejlen er en forbindelsesfejl, ikke en afvisning. */
      forbindelse: boolean;
    }
  | { status: "signed-in"; session: S };

export interface AuthApi<S> {
  state: AuthState<S>;
  /** Firebases eget login (redirect/popup). Reserven. */
  signIn: () => Promise<void>;
  /**
   * Google Identity Services: vi har allerede id-tokenet og veksler det til en
   * Firebase-session. Ingen navigation væk fra siden undervejs.
   */
  signInWithGoogleToken: (idToken: string) => Promise<void>;
  /** Slå brugeren op igen, når opslaget fejlede. Kræver ikke et nyt login. */
  retry: () => void;
  signOut: () => Promise<void>;
  readonly local: boolean;
}

/** Det, hver app selv skal svare på. */
export interface Opslag<S> {
  /**
   * Hvem er den indloggede i denne app?
   *
   * Svar null, når databasen er spurgt og har sagt nej - så er personen
   * afvist. Kast, når svaret ikke kunne fås, fx uden forbindelse - så viser
   * appen "Prøv igen" i stedet for at kalde personen uvedkommende.
   */
  findSession: (konto: GoogleKonto) => Promise<S | null>;
  /** Den, man er, når appen kører uden Firebase-nøgler (lokal tilstand). */
  lokalSession: S;
}

/**
 * E-mailen, som den sammenlignes og slås op på.
 *
 * Invitationer ligger under e-mailen, så den skal normaliseres ét sted. Det
 * er her, fordi det er her, den indloggedes e-mail bliver renset.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function authCode(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) return String((err as { code: string }).code);
  return err instanceof Error ? err.message : String(err);
}

/**
 * Beskeden, når et login kom tilbage uden svar.
 *
 * Den nævner browseren, fordi det er dér, årsagen sidder: Google-forløbet
 * forlader siden og skal finde tilbage til den samme fane med sin tilstand i
 * behold. Gør browseren ikke det - fordi den åbner Google i en anden fane,
 * en anden app eller en isoleret sandkasse - kommer der ingen fejl, kun
 * tomhed. Se faldgrube 8 i CLAUDE.md.
 */
const TOM_RETUR =
  "Login kom ikke igennem: din browser gav ikke Googles svar tilbage til appen. " +
  "Prøv i Chrome, eller slå beskyttelse mod sporing fra for dette websted.";

function loginErrorMessage(err: unknown): string {
  const code = authCode(err);
  if (code.includes("network-request-failed")) return "Ingen forbindelse. Prøv igen.";
  if (code.includes("unauthorized-domain")) {
    return "Dette domæne er ikke godkendt til login. Tilføj det under Authentication → Settings i Firebase.";
  }
  // Den klassiske: tilstanden fra udturen fandtes ikke, da vi kom tilbage.
  if (code.includes("missing initial state")) return TOM_RETUR;
  return "Login mislykkedes. Prøv igen.";
}

/*
 * Mærket for "vi er sendt afsted til Google".
 *
 * Uden det kan appen ikke se forskel på "ingen har prøvet at logge ind" og
 * "nogen prøvede, og forløbet kom tomt tilbage". Begge ender som en blank
 * loginside, og den anden af dem er en fejl, brugeren skal have at vide.
 *
 * localStorage frem for sessionStorage med vilje: det er netop fanen, der
 * ikke kan regnes med at overleve turen. Navnet er neutralt, for lagringen
 * hører til domænet, og hver app har sit eget.
 */
const REDIRECT_MAERKE = "login-undervejs";
/** Ældre end det, og det er en glemt tur, ikke den vi lige kom hjem fra. */
const MAERKE_LEVETID = 5 * 60 * 1000;

function saetMaerke(): void {
  try {
    localStorage.setItem(REDIRECT_MAERKE, String(Date.now()));
  } catch {
    // Privat vindue eller blokeret lagring. Så mister vi kun diagnosen.
  }
}

function ryddMaerke(): void {
  try {
    localStorage.removeItem(REDIRECT_MAERKE);
  } catch {
    /* som ovenfor */
  }
}

function laesMaerke(): boolean {
  try {
    const raw = localStorage.getItem(REDIRECT_MAERKE);
    if (!raw) return false;
    ryddMaerke();
    return Date.now() - Number(raw) < MAERKE_LEVETID;
  } catch {
    return false;
  }
}

/*
 * Kom vi lige tilbage fra Google? Det afgøres én gang pr. sideindlæsning, og
 * svaret gemmes her, uden for React.
 *
 * Mærket blev før læst og ryddet i en effekt. Under udvikling kører React
 * effekter to gange: første gang brugte mærket op, så anden gang - den, der
 * gælder - aldrig så det, og "Login kom ikke igennem" blev ikke vist. Fundet
 * mod emulatoren.
 */
let efterRedirect: boolean | undefined;

function komFraRedirect(): boolean {
  efterRedirect ??= laesMaerke();
  return efterRedirect;
}

function wasCancelled(err: unknown): boolean {
  const code = authCode(err);
  return (
    code.includes("popup-closed-by-user") ||
    code.includes("cancelled-popup") ||
    code.includes("popup-cancelled")
  );
}

/**
 * Hvornår popup ikke duer.
 *
 * Popup-flowet navigerer popup-vinduet til Google og tilbage. Firefox og Safari
 * partitionerer lagring pr. top-niveau-site, og undervejs kan den sessionStorage,
 * Firebases handler har lagt fra sig, gå tabt - så fejler login med
 * "Unable to process request due to missing initial state".
 *
 * Redirect bliver i hovedvinduet på vores eget domæne hele vejen og rammer det
 * ikke. Det koster en sidenavigation, men virker.
 */
function mustRedirect(): boolean {
  /*
   * Mod emulatoren altid redirect. Det er den vej, telefoner, Firefox og
   * Safari bruger, så det er den, der er mest værd at kunne afprøve. Og en
   * popup kan ikke sende svaret tilbage i en browser, der åbner den i samme
   * fane, fx browserpanelet i Claude-appen.
   */
  if (EMULATOR) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (/Firefox\//.test(ua)) return true;
  // Safari på desktop; Chrome/Edge melder sig også som Safari, derfor undtagelsen.
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return true;
  return false;
}

function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Tving kontovælgeren frem - flere i familien deler måske telefon.
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * Send browseren til Google. Mærket sættes først, så en tur, der kommer tomt
 * tilbage, kan kendes fra et besøg, hvor ingen prøvede at logge ind.
 */
async function tilGoogle(firebaseAuth: Auth): Promise<void> {
  saetMaerke();
  try {
    await signInWithRedirect(firebaseAuth, googleProvider());
  } catch (err) {
    // Vi kom aldrig afsted, så der er ingen tur at vente hjem fra.
    ryddMaerke();
    throw err;
  }
}

/** Navnet kommer fra Google-kontoen; e-mailen er nødløsningen, hvis det mangler. */
function displayName(user: FirebaseUser): string {
  return user.displayName?.trim() || (user.email ?? "").split("@")[0] || "Ukendt";
}

function konto(user: FirebaseUser): GoogleKonto {
  return { uid: user.uid, email: normalizeEmail(user.email), name: displayName(user) };
}

/** Er fejlen "vi kunne ikke nå frem", frem for "vi fik nej"? */
function erForbindelsesfejl(code: string): boolean {
  return (
    code.includes("unavailable") || code.includes("network") || code.includes("offline")
  );
}

/** Hvorfor opslaget i databasen ikke lykkedes - sagt så det kan handles på. */
function lookupErrorMessage(err: unknown): string {
  const code = authCode(err);
  if (code.includes("permission-denied")) {
    // Den anden fane først: det er den forklaring, brugeren selv kan gøre
    // noget ved. Se slaaOp.
    return (
      "Databasen afviste opslaget. Er appen åben i en anden fane, så luk den, og prøv igen. " +
      "Ellers er det en fejl i adgangsreglerne, ikke i din konto."
    );
  }
  if (erForbindelsesfejl(code)) {
    /*
     * Beskeden nævner værtsnavnet med vilje.
     *
     * "Tjek forbindelsen" er ubrugeligt, når forbindelsen er fin og det er
     * browseren, der spærrer - og netop dét ligner ingen forbindelse indefra.
     * Med værtsnavnet kan man selv afgøre det: åbn det i en fane. Svarer det
     * med en fejl fra Google, er vejen åben, og så sidder problemet i appens
     * egen adgang til den.
     */
    return (
      "Kunne ikke nå databasen (firestore.googleapis.com). Er der forbindelse ellers, " +
      "blokerer browseren den sandsynligvis: slå beskyttelse mod sporing fra for dette " +
      "websted, eller brug Chrome."
    );
  }
  return "Kunne ikke slå din bruger op. Prøv igen.";
}

/**
 * Pauserne før hvert nyt forsøg, når databasen har afvist opslaget. I alt
 * 6,5 sekunder, så venteskærmen ikke når at melde, at det tager for lang tid
 * (efter 8).
 */
const AFVIST_PAUSER_MS = [500, 1000, 2000, 3000];

/**
 * Appens opslag - prøvet igen et par gange, hvis databasen afviser det.
 *
 * Firestore deler den lokale database mellem appens faner
 * (persistentMultipleTabManager i firebase.ts), og kun én af dem, den
 * primære, taler med serveren, også på de andres vegne. Logger man ind i en
 * fane, der ikke er den primære, sendes opslaget af en anden fane, med den
 * fanes login. Den opdager først det nye login, når dens Auth næste gang
 * kigger efter i IndexedDB, og indtil da går opslaget ud uden login, og
 * reglerne siger nej.
 *
 * Målt mod emulatoren 16. okt. 2026: det afviste opslag har request.auth null
 * i emulatorens log, mens fanen, der spurgte, var logget ind. Med to faner
 * afvises det første opslag hver gang, med én aldrig, og et nyt forsøg
 * lidt efter går igennem. KristianHebert/elbilvalg#29.
 *
 * En synlig fane tager selv rollen som primær, så det rammer, når en anden
 * fane også er synlig - eller ingen af dem er, som i browserpanelet i
 * Claude-appen, der kan have faner fra flere sessioner.
 *
 * Kun permission-denied prøves igen. En regel, der faktisk siger nej, ender
 * stadig i "Prøv igen" med koden, bare et par sekunder senere.
 */
async function slaaOp<S>(
  findSession: Opslag<S>["findSession"],
  k: GoogleKonto,
  gaeldende: () => boolean,
): Promise<S | null> {
  for (let i = 0; ; i++) {
    try {
      return await findSession(k);
    } catch (err) {
      const pause = AFVIST_PAUSER_MS[i];
      if (pause === undefined || !gaeldende() || !authCode(err).includes("permission-denied")) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, pause));
    }
  }
}

/**
 * Login til én app: Google-login ad begge veje, og appens eget opslag af,
 * hvem den indloggede er.
 *
 * En fabrik frem for en færdig provider, fordi hver app har sin egen session
 * - elbil-appens har en rolle, madplanens har grupper - og en React-context
 * kan ikke have en typeparameter. Kald den én gang, i modulets top, og brug
 * det, den giver tilbage. Kaldt inde i en komponent ville hver gengivelse
 * lave en ny context.
 */
export function lavLogin<S>({ findSession, lokalSession }: Opslag<S>) {
  const AuthContext = createContext<AuthApi<S> | null>(null);

  function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState<S>>({ status: "loading" });
    /** Den indloggede, så et mislykket opslag kan prøves igen uden nyt login. */
    const fbUserRef = useRef<FirebaseUser | null>(null);

    /*
     * Afgør hvem den indloggede er.
     *
     * De to udfald holdes skarpt adskilt. Svarer findSession null, har vi
     * spurgt databasen og fået nej - så er personen afvist. Kaster den, ved
     * vi ingenting, og så må vi ikke sige "du har ikke adgang". Det gjorde
     * den før, og så meldte en telefon uden forbindelse til Firestore, at
     * husets ejer ikke havde adgang til sin egen app.
     */
    const afgoer = useCallback((fbUser: FirebaseUser) => {
      setState({ status: "loading" });
      // Er det stadig den indloggede, når svaret kommer? Med de nye forsøg
      // kan der gå sekunder, og logger man ud imens, må svaret ikke lægge
      // sig oven på loginsiden.
      const gaeldende = () => fbUserRef.current?.uid === fbUser.uid;
      // slaaOp er async, så også en fejl, der kastes med det samme, bliver
      // til "Prøv igen" og ikke til en hvid side.
      void slaaOp(findSession, konto(fbUser), gaeldende)
        .then((session) => {
          if (!gaeldende()) return;
          setState(
            session
              ? { status: "signed-in", session }
              : { status: "denied", email: fbUser.email ?? "" },
          );
        })
        .catch((err: unknown) => {
          if (!gaeldende()) return;
          const code = authCode(err);
          setState({
            status: "unresolved",
            email: fbUser.email ?? "",
            message: lookupErrorMessage(err),
            code,
            forbindelse: erForbindelsesfejl(code),
          });
        });
    }, []);

    const retry = useCallback(() => {
      const fbUser = fbUserRef.current;
      if (fbUser) afgoer(fbUser);
    }, [afgoer]);

    useEffect(() => {
      if (!isFirebaseConfigured) {
        setState({ status: "signed-in", session: lokalSession });
        return;
      }

      const firebaseAuth = auth();

      void getRedirectResult(firebaseAuth).catch((err) => {
        if (wasCancelled(err)) return;
        setState({ status: "signed-out", error: loginErrorMessage(err) });
      });

      /*
       * Kun den første tilstand siger noget om turen til Google. Logger man
       * ud senere i samme indlæsning, er det ikke et login, der faldt på
       * gulvet - men det var præcis, hvad appen sagde, før de to blev skilt
       * ad: efter et login via redirect gav "Log ud" beskeden om, at browseren
       * ikke havde givet Googles svar tilbage.
       */
      let foerste = true;
      return onAuthStateChanged(firebaseAuth, (fbUser) => {
        const tomRetur = foerste && !fbUser && komFraRedirect();
        foerste = false;
        fbUserRef.current = fbUser;
        if (!fbUser) {
          setState((prev) => {
            if (prev.status === "signed-out" && prev.error) return prev;
            // Vi blev sendt til Google, kom tilbage - og står stadig uden
            // bruger. Det er ikke "ikke logget ind", det er et login, der
            // faldt på gulvet undervejs, og det skal siges.
            return tomRetur
              ? { status: "signed-out", error: TOM_RETUR }
              : { status: "signed-out" };
          });
          return;
        }
        ryddMaerke();
        afgoer(fbUser);
      });
    }, [afgoer]);

    const signIn = useCallback(async () => {
      if (!isFirebaseConfigured) return;
      try {
        const firebaseAuth = auth();
        if (mustRedirect()) {
          await tilGoogle(firebaseAuth);
          return;
        }
        await signInWithPopup(firebaseAuth, googleProvider());
      } catch (err) {
        if (wasCancelled(err)) {
          setState({ status: "signed-out" });
          return;
        }
        const code = authCode(err);
        // "missing initial state" er den partitionerede lagring, der slog til
        // alligevel. Redirect er vejen udenom, så vi prøver den frem for at
        // efterlade brugeren med en fejl, de ikke kan gøre noget ved.
        if (
          code.includes("popup-blocked") ||
          code.includes("web-storage-unsupported") ||
          code.includes("missing initial state")
        ) {
          try {
            await tilGoogle(auth());
            return;
          } catch (redirectErr) {
            setState({ status: "signed-out", error: loginErrorMessage(redirectErr) });
            return;
          }
        }
        setState({ status: "signed-out", error: loginErrorMessage(err) });
      }
    }, []);

    const signInWithGoogleToken = useCallback(async (idToken: string) => {
      if (!isFirebaseConfigured) return;
      try {
        await signInWithCredential(auth(), GoogleAuthProvider.credential(idToken));
        // onAuthStateChanged tager over herfra og finder brugeren frem.
      } catch (err) {
        setState({ status: "signed-out", error: loginErrorMessage(err) });
      }
    }, []);

    const signOut = useCallback(async () => {
      if (!isFirebaseConfigured) return;
      await fbSignOut(auth());
    }, []);

    const api = useMemo<AuthApi<S>>(
      () => ({
        state,
        signIn,
        signInWithGoogleToken,
        retry,
        signOut,
        local: !isFirebaseConfigured,
      }),
      [state, signIn, signInWithGoogleToken, retry, signOut],
    );

    return <AuthContext value={api}>{children}</AuthContext>;
  }

  function useAuth(): AuthApi<S> {
    const ctx = use(AuthContext);
    if (!ctx) throw new Error("useAuth skal bruges inde i <AuthProvider>");
    return ctx;
  }

  /**
   * Appen, når man er logget ind - og indtil da venteskærmen, login, afvist
   * eller "Prøv igen".
   *
   * Appen får sin session som argument. Så skal den aldrig selv tjekke, om
   * der er en, og den kan ikke komme til at vise noget, før der er.
   */
  function Adgang({
    children,
    ...app
  }: AppOplysninger & { children: (session: S) => ReactNode }) {
    const login = useAuth();
    if (login.state.status === "signed-in") return children(login.state.session);
    return <Port login={login} app={app} />;
  }

  return { AuthProvider, useAuth, Adgang };
}
