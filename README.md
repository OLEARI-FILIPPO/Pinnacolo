# Pinnacolo Reggiano Online

MVP iniziale per un gioco online del Pinnacolo Reggiano a 19 carte.

## Stack
- Frontend: Angular
- Backend: NestJS + Socket.IO
- Shared models: TypeScript package locale

## Avvio sviluppo
1. Installare dipendenze root: `npm install`
2. Avviare frontend + backend: `npm run dev`
3. Frontend pubblico: https://pinnacoloreggiano.netlify.app/
4. Backend pubblico: https://pinnacoloreggianoservice.onrender.com
5. Health check backend: https://pinnacoloreggianoservice.onrender.com/health

## Persistenza tavoli
- Il backend salva lo stato tavoli su Postgres se e' presente la variabile ambiente `DATABASE_URL`.
- Se `DATABASE_URL` non e' configurata, usa fallback locale su file (`.data/tables-state.json`).
- Per deploy cloud conviene sempre configurare `DATABASE_URL` (Neon/Supabase/Render Postgres hanno piani gratuiti).

## Prima partita locale (MVP)
1. Aprire il browser su https://pinnacoloreggiano.netlify.app/
2. Inserire un codice tavolo (es. reggio-01)
3. Premere Entra e avvia partita
4. Il sistema crea automaticamente 3 bot e distribuisce le carte
5. Durante il tuo turno scegli graficamente le carte da calare o da scartare
6. I bot giocano automaticamente nei loro turni

## Stato attuale
- Lobby iniziale Angular
- Pagina tavolo Angular grafica con carte, ordinamento mano e selezione combinazioni
- Gateway Socket.IO NestJS con sessione singola + 3 bot automatici
- Motore turno server-authoritative con distribuzione 108 carte, tris/scale naturali e chiusura mano

## Prossimi step
- Implementare regole complete del turno (pesca, cala/attacca, scarto)
- Validazione combinazioni (tris, scale, pinelle/jolly)
- Conteggio punteggio Reggiano e chiusura mano
- Persistenza partita e reconnect robusto
