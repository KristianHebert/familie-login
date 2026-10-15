import { useEffect, useRef, useState } from "react";
import type { AuthApi, AuthState } from "./login";
import { ryddLokaleData } from "./firebase";
import { renderGoogleButton, shouldTryGis } from "./gis";
import "./adgang.css";

/** Det, skærmene skal vide om appen, de står foran. */
export interface AppOplysninger {
  /** Står som overskrift, fx "Familiens elbilvalg". */
  navn: string;
  /** Én sætning om, hvad appen er til. Står over login-knappen. */
  beskrivelse: string;
  /** Appens ikon, fx "/icons/icon-192.png". */
  ikon: string;
  /** Hvornår denne udgave blev bygget. */
  version: string;
  /** Vejledningen i at lægge appen på telefonen. Udelades, hvis der ingen er. */
  installer?: string;
}

/** Skærmene ser ikke sessionen, så de er ens for alle apps. */
type Login = AuthApi<unknown>;
type UafklaretTilstand = Extract<AuthState<unknown>, { status: "unresolved" }>;

/** Det, der står i appens sted, indtil man er logget ind. */
export function Port({ login, app }: { login: Login; app: AppOplysninger }) {
  const { state } = login;
  switch (state.status) {
    case "loading":
      return <Henter version={app.version} />;
    case "denied":
      return <LogInd login={login} app={app} denied={state.email} />;
    case "unresolved":
      return <Uafklaret login={login} app={app} fejl={state} />;
    case "signed-out":
      return <LogInd login={login} app={app} error={state.error} />;
    case "signed-in":
      // Adgang viser selv appen, så hertil kommer vi ikke.
      return null;
  }
}

type GisState = "loading" | "ready" | "unavailable";

/**
 * Loginskærm, også når man er afvist. Den vises kun i Firebase-tilstand -
 * kører appen lokalt uden database, er man automatisk logget ind som den ene
 * lokale bruger.
 *
 * Primært login er Google Identity Services, fordi det ikke navigerer væk fra
 * siden og derfor overlever browserudvidelser, der åbner Google i en separat
 * container. Firebases eget login står som reserve: kan GIS ikke indlæses,
 * eller vil det ikke spille, skal ingen være låst ude.
 */
function LogInd({
  login,
  app,
  error,
  denied,
}: {
  login: Login;
  app: AppOplysninger;
  error?: string | undefined;
  denied?: string | undefined;
}) {
  const { signIn, signInWithGoogleToken, signOut } = login;
  const [busy, setBusy] = useState(false);
  const [gis, setGis] = useState<GisState>(shouldTryGis() ? "loading" : "unavailable");
  const [gisError, setGisError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldTryGis() || denied) return;
    const el = buttonRef.current;
    if (!el) return;

    let cancelled = false;
    void renderGoogleButton(
      el,
      (idToken) => {
        if (cancelled) return;
        setBusy(true);
        void signInWithGoogleToken(idToken).finally(() => setBusy(false));
      },
      (message) => {
        if (!cancelled) setGisError(message);
      },
    )
      .then(() => {
        if (!cancelled) setGis("ready");
      })
      .catch(() => {
        // Scriptet blev blokeret eller svarede ikke. Ikke en fejl brugeren skal
        // forholde sig til - de får bare reserveknappen i stedet.
        if (!cancelled) setGis("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [signInWithGoogleToken, denied]);

  const fallback = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adgang">
      <div className="adgang-kort">
        <img src={app.ikon} alt="" width={88} height={88} />
        <h1>{app.navn}</h1>

        {denied ? (
          <>
            <p className="adgang-svag">
              <b>{denied}</b> har ikke adgang. Bed om en invitation, eller log ind med den
              konto, der er inviteret.
            </p>
            <button type="button" className="adgang-knap" onClick={() => void signOut()}>
              Log ud og prøv igen
            </button>
          </>
        ) : (
          <>
            <p className="adgang-svag">
              {app.beskrivelse} Log ind med den Google-konto, der er inviteret.
            </p>

            {/* Googles egen knap tegnes ind her, når scriptet er hentet. */}
            <div ref={buttonRef} hidden={gis !== "ready"} />

            {gis === "loading" ? (
              <p className="adgang-svag adgang-lille">Henter Googles login …</p>
            ) : null}

            {/*
              Begge veje er altid synlige som knapper. Da GIS var primær og
              den anden vej lå i et lille link, stod brugere i Firefox reelt
              uden en vej ind - knappen virkede, men gennemførte aldrig.
            */}
            <button
              type="button"
              className={gis === "ready" ? "adgang-sekundaer" : "adgang-knap"}
              disabled={busy}
              onClick={() => void fallback()}
            >
              {busy
                ? "Logger ind …"
                : gis === "ready"
                  ? "Log ind på den anden måde"
                  : "Log ind med Google"}
            </button>
          </>
        )}

        {app.installer ? (
          <p className="adgang-lille adgang-installer">
            <a href={app.installer}>Sådan lægger du appen på telefonen</a>
          </p>
        ) : null}

        {/*
          Versionen hører hjemme her og ikke kun inde i appen. Står man uden
          for døren - fordi login eller databasen driller - er det netop dér,
          man har brug for at vide, om enheden overhovedet kører den udgave,
          der bliver talt om. En service worker kan servere en gammel i dagevis.
        */}
        <Version version={app.version} />

        {gisError ? (
          <p className="adgang-svag adgang-lille" role="alert">
            {gisError}
          </p>
        ) : null}

        {error ? (
          <p className="adgang-svag adgang-lille" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Logget ind, men opslaget i databasen fejlede.
 *
 * Skærmen findes, fordi alternativet var at kalde folk uvedkommende. Den
 * siger, hvad der rent faktisk skete, og tilbyder det eneste, der plejer at
 * hjælpe: prøv igen. Log ud står der også - men som den mindre knap, for det
 * fjerner sessionen uden at løse noget.
 */
function Uafklaret({
  login,
  app,
  fejl,
}: {
  login: Login;
  app: AppOplysninger;
  fejl: UafklaretTilstand;
}) {
  const { retry, signOut } = login;

  return (
    <div className="adgang">
      <div className="adgang-kort">
        <img src={app.ikon} alt="" width={88} height={88} />
        <h1>{app.navn}</h1>
        <p className="adgang-svag">
          Du er logget ind som <b>{fejl.email}</b>, men appen kunne ikke hente dine
          oplysninger.
        </p>
        <p className="adgang-lille adgang-svag">{fejl.message}</p>
        <button type="button" className="adgang-knap" onClick={retry}>
          Prøv igen
        </button>

        {/*
          Den ene reparation, der er værd at have her. En cache eller en kø af
          usendte skrivninger, der har sat sig fast, giver præcis samme billede
          som et netværk, der er nede - og det kan enheden ikke komme ud af ved
          egen kraft, for det overlever genstart.
        */}
        {fejl.forbindelse ? (
          <button
            type="button"
            className="adgang-sekundaer"
            onClick={() => {
              void ryddLokaleData()
                .catch(() => {})
                .finally(() => location.reload());
            }}
          >
            Ryd appens lokale data
          </button>
        ) : null}

        <button type="button" className="adgang-sekundaer" onClick={() => void signOut()}>
          Log ud
        </button>

        <Version version={app.version} />

        {/* Fejlkoden i det små: nok til at fejlsøge på afstand, lille nok til
            ikke at fylde for dem, der bare vil ind. */}
        <p className="adgang-lille adgang-svag">
          <code>{fejl.code}</code>
        </p>
      </div>
    </div>
  );
}

/**
 * Venteskærmen.
 *
 * Den plejede at sige "Henter …" og ellers ingenting. Når Firebase Auth gav
 * op efter sine tredive sekunder, havde brugeren stirret på det samme ord i
 * en halv evighed og fik så loginsiden igen, uden en forklaring. Nu fortæller
 * skærmen selv, at det tager for lang tid, og hvad man kan gøre ved det.
 */
function Henter({ version }: { version: string }) {
  const [sekunder, setSekunder] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSekunder((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="adgang">
      <div className="adgang-kort">
        <p className="adgang-svag">Henter …</p>
        {sekunder >= 8 ? (
          <p className="adgang-lille adgang-svag">
            Det tager længere end normalt. Venter på svar fra Google.
          </p>
        ) : null}
        {sekunder >= 8 ? <Version version={version} /> : null}
        {sekunder >= 20 ? (
          <p className="adgang-lille adgang-svag">
            Kommer der ikke noget, har browseren sandsynligvis blokeret svaret.
            Prøv i Chrome, eller slå beskyttelse mod sporing fra for dette websted.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Hvilken udgave kører denne enhed?
 *
 * Tidspunktet bages ind ved bygning. Det er ikke pynt: med
 * `registerType: "prompt"` skifter en enhed ikke selv til en ny udgave, så to
 * browsere på den samme telefon kan sagtens køre hver sin - og en fejlsøgning,
 * hvor man ikke ved hvilken kode der kører, er ikke en fejlsøgning.
 */
function Version({ version }: { version: string }) {
  return <p className="adgang-lille adgang-svag adgang-version">version {version}</p>;
}
