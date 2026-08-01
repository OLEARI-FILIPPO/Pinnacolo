import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameSocketService } from '../../core/services/game-socket.service';

@Component({
  selector: 'app-lobby-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="layout">
      <section class="card">
        <h1>Pinnacolo Reggiano Online</h1>
        <p class="subtitle">Scegli un tavolo aperto o creane uno nuovo. Puoi avviare in 2-4 giocatori, con o senza bot.</p>

        <label for="displayName">Il tuo nome</label>
        <input id="displayName" [(ngModel)]="displayName" placeholder="es. Luca" />

        <div class="identity-row">
          <span>ID locale: {{ playerId }}</span>
          <button type="button" class="secondary" (click)="createNewLocalPlayer()">Nuovo giocatore locale</button>
        </div>

        <div class="create-row">
          <input [(ngModel)]="tableCode" placeholder="nuovo tavolo (es. reggio-03)" />
          <select [(ngModel)]="targetPlayers">
            <option [ngValue]="2">2 giocatori</option>
            <option [ngValue]="3">3 giocatori</option>
            <option [ngValue]="4">4 giocatori</option>
          </select>
          <button type="button" (click)="createTable()" [disabled]="!canEnter()">Crea tavolo</button>
        </div>

        <h2>Tavoli aperti</h2>
        <div class="table-list" *ngIf="socket.tables().length > 0; else noTables">
          <article class="table-item" *ngFor="let table of socket.tables()">
            <div class="table-main">
              <h3>{{ table.tableId }}</h3>
              <p>
                Stato: {{ table.status }} | Giocatori: {{ table.playersCount }}/{{ table.targetPlayers }}
                (Umani {{ table.humansCount }} - Bot {{ table.botsCount }})
              </p>
              <p>Owner: {{ table.ownerDisplayName ?? table.ownerPlayerId ?? 'n/d' }}</p>
            </div>
            <div class="table-actions">
              <button type="button" (click)="joinTable(table.tableId)" [disabled]="!canEnter()">Entra</button>
              <button
                type="button"
                class="secondary"
                (click)="addBot(table.tableId)"
                [disabled]="!canEnter() || table.status !== 'waiting' || table.playersCount >= table.maxPlayers || !isOwner(table.ownerPlayerId)"
              >
                + Bot
              </button>
              <button
                type="button"
                class="secondary"
                (click)="startTable(table.tableId)"
                [disabled]="!canEnter() || table.status !== 'waiting' || table.playersCount !== table.targetPlayers || !isOwner(table.ownerPlayerId)"
              >
                Avvia
              </button>
              <button
                type="button"
                class="danger"
                (click)="deleteTable(table.tableId)"
                [disabled]="!isOwner(table.ownerPlayerId)"
              >
                Elimina
              </button>
            </div>
          </article>
        </div>

        <ng-template #noTables>
          <p class="empty">Nessun tavolo disponibile. Creane uno con il pulsante qui sopra.</p>
        </ng-template>

        <button type="button" class="secondary" (click)="socket.refreshTables()">Aggiorna lista</button>

        <p class="hint" *ngIf="socket.latestError()">Errore: {{ socket.latestError() }}</p>
      </section>
    </main>
  `,
  styles: [
    `
      .layout {
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: radial-gradient(circle at 20% 20%, #f8e6cc, #d6ebda 45%, #bdd3ea);
      }

      .card {
        width: min(860px, 100%);
        background: #ffffffd9;
        border-radius: 20px;
        padding: 28px;
        border: 1px solid #0f283633;
        box-shadow: 0 16px 40px #0f28361f;
        display: grid;
        gap: 12px;
      }

      h1 {
        margin: 0;
        color: #0f2836;
        font-size: 1.85rem;
      }

      .subtitle {
        margin: 0 0 12px;
        color: #29485f;
      }

      label {
        color: #0f2836;
        font-weight: 600;
      }

      input {
        width: 100%;
        border: 1px solid #95a6b4;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 1rem;
      }

      .create-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 8px;
      }

      .identity-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #2d4f66;
        font-size: 0.9rem;
      }

      h2 {
        margin: 10px 0 0;
        color: #0f2836;
      }

      .table-list {
        display: grid;
        gap: 10px;
      }

      .table-item {
        border: 1px solid #0f28362f;
        border-radius: 12px;
        padding: 10px;
        background: #ffffffc8;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
      }

      .table-main h3 {
        margin: 0;
        color: #123149;
      }

      .table-main p {
        margin: 4px 0 0;
        color: #2d4f66;
        font-size: 0.95rem;
      }

      .table-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      button {
        border: 0;
        border-radius: 10px;
        background: #0f2836;
        color: #fff;
        padding: 11px 16px;
        font-weight: 600;
        cursor: pointer;
      }

      button.secondary {
        background: #2a4f67;
      }

      button.danger {
        background: #8a2e2e;
      }

      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .empty {
        margin: 0;
        color: #2d4f66;
      }

      .hint {
        margin: 4px 0 0;
        color: #8a2e2e;
        font-size: 0.95rem;
      }
    `,
  ],
})
export class LobbyPageComponent {
  tableCode = this.generateTableCode();
  displayName = this.loadDisplayName();
  targetPlayers = 2;
  playerId = this.resolveHumanPlayerId();

  constructor(readonly socket: GameSocketService, private readonly router: Router) {
    this.socket.connect();
    this.socket.refreshTables();
  }

  canEnter() {
    return Boolean(this.displayName.trim());
  }

  createTable() {
    const name = this.displayName.trim();
    if (!name) {
      return;
    }

    const tableId = this.tableCode.trim();
    if (!tableId) {
      return;
    }

    this.persistDisplayName(name);
    this.socket.createTable(tableId, this.playerId, name, this.targetPlayers);
    this.socket.joinTable(tableId, this.playerId, name);
    void this.router.navigate(['/table', tableId], {
      queryParams: { playerId: this.playerId },
    });

    this.tableCode = this.generateTableCode();
  }

  joinTable(tableId: string) {
    const name = this.displayName.trim();
    if (!name) {
      return;
    }

    this.persistDisplayName(name);
    this.socket.joinTable(tableId, this.playerId, name);
    void this.router.navigate(['/table', tableId], {
      queryParams: { playerId: this.playerId },
    });
  }

  addBot(tableId: string) {
    this.socket.addBot(tableId);
  }

  startTable(tableId: string) {
    this.socket.startTable(tableId, this.playerId);
  }

  deleteTable(tableId: string) {
    if (!confirm(`Eliminare il tavolo ${tableId}?`)) {
      return;
    }

    this.socket.deleteTable(tableId, this.playerId);
  }

  isOwner(ownerPlayerId: string | null) {
    return ownerPlayerId === this.playerId;
  }

  createNewLocalPlayer() {
    this.playerId = this.generateHumanPlayerId();
    localStorage.setItem('pinnacolo-human-player-id', this.playerId);
  }

  private resolveHumanPlayerId(): string {
    const key = 'pinnacolo-human-player-id';
    const existing = localStorage.getItem(key);
    if (existing) {
      return existing;
    }

    const generated = this.generateHumanPlayerId();
    localStorage.setItem(key, generated);
    return generated;
  }

  private generateHumanPlayerId() {
    return `you-${Math.random().toString(16).slice(2, 8)}`;
  }

  private loadDisplayName() {
    return localStorage.getItem('pinnacolo-display-name') ?? '';
  }

  private persistDisplayName(value: string) {
    localStorage.setItem('pinnacolo-display-name', value);
  }

  private generateTableCode() {
    return `reggio-${Math.floor(100 + Math.random() * 900)}`;
  }
}
