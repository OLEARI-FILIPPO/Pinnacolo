# Pinnacolo Reggiano Online

MVP iniziale per un gioco online del Pinnacolo Reggiano a 19 carte.

## Stack
- Frontend: Angular
- Backend: NestJS + Socket.IO
- Shared models: TypeScript package locale

## Avvio sviluppo
1. Installare dipendenze root: `npm install`
2. Avviare frontend + backend: `npm run dev`
3. Frontend: http://localhost:4200
4. Backend: http://localhost:3000
5. Health check backend: http://localhost:3000/health

## Prima partita locale (MVP)
1. Aprire il browser su http://localhost:4200
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
