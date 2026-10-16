# familie-login

Login og Firebase-opsætning til familiens webapps,
[elbilvalg](https://github.com/KristianHebert/elbilvalg) og
[madplan](https://github.com/KristianHebert/madplan): Google-login ad to veje
(Google Identity Services og Firebases eget login), skærmene før appen
(venteskærm, login, afvist og "Prøv igen"), opdateringsprompten til en PWA,
"Ikke sendt endnu" for skrivninger, databasen ikke har kvitteret for,
og et byggetjek, der stopper et byg uden Firebase-nøgler.

Login er den kode, der har kostet mest, og den skal kun findes ét sted.
Lektierne bag den står i CLAUDE.md i de to apps.

## Brug

Pakken er TypeScript-kildekode og bygges ikke for sig. Appen henter den fra
GitHub, låst til en version:

```json
"dependencies": {
  "@familieapps/familie": "github:KristianHebert/familie-login#v1.0.0"
}
```

…og lader sin egen Vite oversætte den. Den skal stå i `optimizeDeps.exclude`,
for pakken importerer `virtual:pwa-register/react`, som kun appens
vite-plugin-pwa kan levere. Og Firebase skal stå i `optimizeDeps.include`:
ellers ser Vite ikke, at pakken bruger Firebase, og så får appen to kopier
under udvikling, så snart dens egen kode bruger Firestore. Login ender da i
"Service firestore is not available".

```ts
import { kraevNoegler } from "@familieapps/familie/vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@familieapps/familie"],
    include: ["firebase/app", "firebase/auth", "firebase/firestore"],
  },
  plugins: [kraevNoegler(), react(), VitePWA({ /* … */ })],
});
```

Appen svarer på ét spørgsmål, hvem den indloggede er, og får resten tilbage:

```ts
export const { AuthProvider, useAuth, Adgang } = lavLogin<Session>({
  findSession,   // null = databasen sagde nej; kast = vi ved det ikke
  lokalSession,  // den, man er uden Firebase-nøgler
});
```

Skærmene tager farverne fra appens CSS-variabler: `--accent`,
`--accent-ink`, `--ink`, `--muted`, `--line` og `--chip`.

### Ikke sendt endnu

Firestore skriver til den lokale kopi først og sender bagefter, så en
skrivning kan ligge i kø, mens appen ser færdig ud. Hvert abonnement, der
viser noget, man selv kan skrive, melder sin tilstand:

```ts
const stop = onSnapshot(q, MED_METADATA, (snap) => {
  noterUafsendt("shopping", snap.metadata.hasPendingWrites);
  // …
});
return () => {
  glemUafsendt("shopping");
  stop();
};
```

`<IkkeSendt />` i topbjælken viser mærket, når en skrivning har hængt i fem
sekunder, med klassen `chip unsent`. `MED_METADATA` er ikke valgfri: uden den
kommer kvitteringen aldrig, og mærket bliver hængende.

### Den lokale kopi

Firestore gemmer 40 MB af databasen på enheden og smider det ældste ud, når
den er fuld. Gemmer appen billeder i databasen, kan den få mere, men kun før
databasen åbnes første gang:

```ts
lokalKopiStoerrelse(200 * 1024 * 1024); // i main.tsx, før render
```

## En ny version

1. Ret her, og kør `npm run typecheck`.
2. Ret `version` i `package.json`, commit, og sæt et tag: `git tag v1.0.1`,
   `git push`, og `git push origin v1.0.1`. `--follow-tags` skubber kun
   annoterede tags, så et tag fra `git tag v1.0.1` bliver hjemme.
3. I hver app: ret tagget i `package.json`, kør `npm install`, og afprøv
   login. Apps flytter hver for sig, så en ændring kan prøves i den ene, før
   den anden får den.

Mens man udvikler på login, kan en app pege på den lokale mappe i stedet:
`"@familieapps/familie": "file:../familie-login"`. Husk at sætte tagget
tilbage, før der committes; et byg på GitHub har ikke mappen.

Repoet er offentligt, så appene kan hente det uden nøgler. Her må derfor
aldrig stå hemmeligheder eller adresser på personer: nøglerne kommer fra
appens `.env.local`, og administratoren står i appen.
