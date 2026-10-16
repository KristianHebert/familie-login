import { useEffect, useState, useSyncExternalStore } from "react";
import type { SnapshotListenOptions } from "firebase/firestore";

/*
 * Uafsendte skrivninger, flyttet hertil fra elbil-appen.
 *
 * Firestore skriver til den lokale kopi først og sender bagefter. Dør
 * forbindelsen imellem de to ting, bliver skrivningen liggende i kø, mens
 * appen ser fuldstændig færdig ud. Sådan kunne fem biler stå som kandidater
 * på en telefon, uden at nogen andre kunne se dem.
 *
 * `metadata.hasPendingWrites` er det eneste, der afslører det, og det kræver
 * `includeMetadataChanges: true` (MED_METADATA). Uden det får abonnementet kun
 * hændelsen, hvor skrivningen lige er lagt i kø - aldrig kvitteringen
 * bagefter, så flaget ville hænge fast på true.
 *
 * Hvert abonnement melder under sit eget navn, og appen er uafsendt, så længe
 * ét af dem er.
 */

/** Indstillingen til de abonnementer, der melder uafsendte skrivninger. */
export const MED_METADATA: SnapshotListenOptions = { includeMetadataChanges: true };

const uafsendt = new Map<string, boolean>();
const lyttere = new Set<() => void>();

const noget = () => [...uafsendt.values()].some(Boolean);

function meld(): void {
  for (const fn of lyttere) fn();
}

/** Kaldes fra abonnementet med `snap.metadata.hasPendingWrites`. */
export function noterUafsendt(kilde: string, vaerdi: boolean): void {
  if (uafsendt.get(kilde) === vaerdi) return;
  uafsendt.set(kilde, vaerdi);
  meld();
}

/** Kaldes, når abonnementet stoppes. Ellers hænger kildens flag ved. */
export function glemUafsendt(kilde: string): void {
  if (uafsendt.delete(kilde)) meld();
}

function abonner(fn: () => void) {
  lyttere.add(fn);
  return () => {
    lyttere.delete(fn);
  };
}

/**
 * Ligger der en skrivning, som databasen ikke har kvitteret for, og har den
 * ligget der i mindst `ventetid` ms?
 *
 * Enhver skrivning er uafsendt i et splitsekund. Det er sådan Firestore
 * virker, og det er ikke værd at fortælle om. Først når den bliver hængende,
 * er der sket noget, brugeren skal vide: ændringen står kun på denne enhed.
 */
export function useUafsendt(ventetid = 5000): boolean {
  const nu = useSyncExternalStore(abonner, noget, () => false);
  const [haenger, setHaenger] = useState(false);

  useEffect(() => {
    if (!nu) {
      setHaenger(false);
      return;
    }
    const timer = setTimeout(() => setHaenger(true), ventetid);
    return () => clearTimeout(timer);
  }, [nu, ventetid]);

  return haenger;
}

/**
 * Mærket til topbjælken. En advarsel frem for en besked, der forsvinder: den
 * gælder, indtil ændringen er sendt, og det kan vare til næste gang telefonen
 * har forbindelse. Klassen er `chip unsent`; appen giver den sit udseende.
 */
export function IkkeSendt() {
  if (!useUafsendt()) return null;
  return (
    <span
      className="chip unsent"
      role="status"
      title="Ændringen er gemt på denne enhed, men databasen har ikke kvitteret. De andre kan ikke se den endnu. Den sendes af sig selv, når forbindelsen er tilbage."
    >
      Ikke sendt endnu
    </span>
  );
}
