import { CommonModule } from '@angular/common';
import { Component, computed, effect, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  GameCardView,
  GameStateView,
  GameSocketService,
  HandSortMode,
  MeldView,
} from '../../core/services/game-socket.service';

@Component({
  selector: 'app-table-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <main class="table-layout">
      <section class="board" *ngIf="socket.table() as table; else waitingState">
        <section class="panel lobby-panel" *ngIf="!table.game">
          <h2>Lobby tavolo</h2>
          <p>Stato: {{ table.status }} | Giocatori: {{ table.players.length }}/{{ table.targetPlayers }}</p>

          <div class="lobby-players">
            <span *ngFor="let player of table.players">{{ player.displayName }}{{ player.playerId === table.ownerPlayerId ? ' (owner)' : '' }}</span>
          </div>

          <button
            type="button"
            class="action restart"
            (click)="startFromTableScreen()"
            *ngIf="isTableOwner(table.ownerPlayerId)"
            [disabled]="!canStartFromTableScreen(table.status, table.players.length, table.targetPlayers)"
          >
            Avvia partita
          </button>
          <p class="hint-inline" *ngIf="isTableOwner(table.ownerPlayerId) && table.players.length !== table.targetPlayers">
            In attesa di {{ table.targetPlayers - table.players.length }} giocatore/i per avviare.
          </p>
        </section>

        <section class="panel players-panel" *ngIf="table.game as game">
          <button type="button" class="players-toggle" (click)="togglePlayersPanel()">
            <h2>Giocatori</h2>
            <span>{{ playersPanelOpen() ? 'Nascondi' : 'Mostra' }}</span>
          </button>
          <div class="players-strip" *ngIf="playersPanelOpen()">
            <article
              class="player-chip"
              *ngFor="let player of game.players"
              [class.turn-active]="!game.finished && game.turnPlayerId === player.playerId"
            >
              <h3>{{ playerDisplayName(player.playerId) }}</h3>
              <p>{{ game.turnPlayerId === player.playerId ? 'In turno' : (player.isBot ? 'BOT' : 'YOU') }} - {{ player.hand.length }} carte</p>
              <div class="bot-move" *ngIf="isLastMoveBy(game, player.playerId)">
                <span class="move-icon">{{ lastMoveIcon(game) }}</span>
                <div class="cards-row" *ngIf="lastMoveCards(game).length > 0">
                  <img
                    class="card-image micro"
                    *ngFor="let card of lastMoveCards(game)"
                    [src]="cardImage(card, true)"
                    [alt]="card.label + ' ' + suitLabel(card.suit)"
                  />
                </div>
              </div>
              <div class="back-cards" *ngIf="player.playerId !== playerId">
                <img class="card-back-mini" *ngFor="let _ of previewBackCards(player.hand.length)" [src]="cardBackImage()" alt="Retro carta" />
              </div>
            </article>
          </div>
        </section>

        <section class="panel score-panel" *ngIf="table.game as game">
          <button type="button" class="score-toggle" (click)="toggleScorePanel()">
            <h2>Punteggio attuale del tavolo</h2>
            <span>{{ scorePanelOpen() ? 'Nascondi' : 'Mostra' }}</span>
          </button>
          <p class="badge turn-badge">Turno attuale: {{ playerDisplayName(game.turnPlayerId) }}</p>
          <div class="scores-grid" *ngIf="scorePanelOpen()">
            <article class="score-item" *ngFor="let row of tableScoreRows(table, game)">
              <h3>{{ playerDisplayName(row.playerId) }}</h3>
              <p>Totale tavolo: {{ row.total }}</p>
              <p>Mani concluse: {{ table.completedHands }}</p>
            </article>
          </div>
        </section>

        <section class="panel final-hand-summary" *ngIf="table.game as game">
          <h2 *ngIf="game.finished">Riepilogo fine mano</h2>
          <div class="scores-grid" *ngIf="game.finished">
            <article
              class="score-item"
              *ngFor="let row of scoreRows(game)"
              [class.final-win]="game.winnerPlayerId === row.playerId"
              [class.final-loss]="game.winnerPlayerId !== row.playerId"
            >
              <h3>{{ playerDisplayName(row.playerId) }} - {{ game.winnerPlayerId === row.playerId ? 'Vittoria' : 'Sconfitta' }}</h3>
              <p>Punti fatti: {{ row.meldPoints }}</p>
              <p>Punti in mano: {{ row.handPoints }}</p>
              <p>Totale mano: {{ row.meldPoints }} - {{ row.handPoints }} = {{ row.partial }}</p>
            </article>
          </div>
        </section>

        <section class="arena" *ngIf="table.game as game">
          <section class="panel discard-area">
            <h2>Pozzo</h2>
            <p class="instruction">Seleziona una carta del pozzo: prenderai quella e tutte le carte successive.</p>

            <div class="discard-scroll" *ngIf="displayedDiscardPile(game).length > 0; else noDiscard" (mouseleave)="clearDiscardHover()">
              <div class="discard-stack" [style.height.px]="discardStackHeight(displayedDiscardPile(game).length)">
                <button
                  class="discard-pick"
                  *ngFor="let card of displayedDiscardPile(game); let i = index"
                  type="button"
                  [class.top-card]="i === displayedDiscardPile(game).length - 1"
                  [class.pending-card]="isPendingDiscardCard(card)"
                  [class.selected]="selectedDiscardCardId() === card.id"
                  [class.hovered]="hoveredDiscardIndex() === i"
                  [class.near-hover]="isNearHoveredDiscard(i)"
                  [style.left.px]="discardOffset(i, displayedDiscardPile(game).length)"
                  [style.zIndex]="discardZIndex(i, displayedDiscardPile(game).length)"
                  [disabled]="isPendingDiscardCard(card)"
                  (click)="selectDiscardCard(card.id)"
                  (mouseenter)="setDiscardHover(i)"
                >
                  <img
                    class="card-image compact discard-card-image"
                    [src]="isPendingDiscardCard(card) ? cardBackImage() : cardImage(card, true)"
                    [alt]="isPendingDiscardCard(card) ? 'Carta in attesa di scarto' : card.label + ' ' + suitLabel(card.suit)"
                  />
                  <span class="top-label" *ngIf="i === displayedDiscardPile(game).length - 1">{{ isPendingDiscardCard(card) ? 'Attesa' : 'Ultima' }}</span>
                </button>
              </div>
            </div>

            <ng-template #noDiscard>
              <div class="empty">Pozzo vuoto</div>
            </ng-template>
          </section>

          <section class="panel table-area">
            <div class="table-head">
              <h2>Carte a terra</h2>
              <div class="owner-filters">
                <button type="button" [class.active]="selectedOwnerPlayerId() === ''" (click)="selectOwnerPlayer('')">Solo mie</button>
                <ng-container *ngFor="let player of game.players">
                  <button
                    type="button"
                    *ngIf="player.playerId !== playerId"
                    [class.active]="selectedOwnerPlayerId() === player.playerId"
                    (click)="selectOwnerPlayer(player.playerId)"
                  >
                    {{ playerDisplayName(player.playerId) }}
                  </button>
                </ng-container>
              </div>
            </div>

            <div class="meld-grid" *ngIf="visibleMelds(game).length > 0; else noMelds">
              <article
                class="meld"
                *ngFor="let meld of visibleMelds(game)"
                [class.last-bot-meld]="isLastBotMeld(game, meld.ownerPlayerId, meld.cards)"
                [class.targetable]="canTargetMeld(game, meld)"
                [class.target-blocked]="!canTargetMeld(game, meld)"
                [class.target-selected]="selectedTargetMeldId() === meld.id"
                (click)="toggleTargetMeld(game, meld)"
              >
                <div class="meld-title-row">
                  <p>{{ playerDisplayName(meld.ownerPlayerId) }} - {{ meld.type === 'set' ? 'Tris/Poker' : 'Scala' }}</p>
                  <span class="meld-value">Valore: {{ meldValue(meld) }}</span>
                </div>
                <div class="cards-row">
                  <div class="meld-card-slot" *ngFor="let card of meld.cards">
                    <img class="card-image compact" [src]="cardImage(card, true)" [alt]="card.label + ' ' + suitLabel(card.suit)" />
                    <span class="wild-badge" *ngIf="wildcardReplacementText(meld, card) as replacement">{{ replacement }}</span>
                  </div>
                </div>
                <p class="meld-target-label" *ngIf="selectedTargetMeldId() === meld.id">Target aggiunta selezionato</p>
              </article>
            </div>
            <ng-template #noMelds>
              <div class="empty">Nessuna combinazione visibile con il filtro attuale.</div>
            </ng-template>
          </section>
        </section>

        <section class="panel actions" *ngIf="table.game as game">
          <div class="howto">
            <span>1) Pesca oppure seleziona carta dal pozzo</span>
            <span>2) Seleziona carte dalla mano</span>
            <span>3) Cala nuova combinazione o scegli una combinazione target</span>
            <span>4) Seleziona 1 carta e scarta</span>
          </div>

          <button type="button" class="action" (click)="drawFromStock()" [disabled]="!canAct(game.phase, 'draw-or-pick')">Pesca</button>
          <button
            type="button"
            class="action"
            (click)="pickDiscardPile()"
            [disabled]="!canAct(game.phase, 'draw-or-pick') || !selectedDiscardCardId()"
          >
            Prendi dal pozzo selezionata
          </button>
          <button
            type="button"
            class="action"
            (click)="playSelectedMeld()"
            [disabled]="!canAct(game.phase, 'meld') || selectedCount() < 3"
          >
            Cala selezionate
          </button>
          <button
            type="button"
            class="action"
            (click)="attachSelectedToMeld()"
            [disabled]="!canAttachSelected(game)"
          >
            Aggiungi a combinazione
          </button>
          <button
            type="button"
            class="action"
            (click)="discardSelectedCard()"
            [disabled]="!canDiscard(game.phase) || selectedCount() !== 1"
          >
            Scarta selezionata
          </button>
          <button type="button" class="action clear" (click)="clearSelection()" [disabled]="selectedCount() === 0">Deseleziona</button>
          <button type="button" class="action restart" (click)="restartGame()">Ricomincia partita</button>

          <p class="error-inline" *ngIf="socket.latestError()">{{ socket.latestError() }}</p>
          <p class="hint-inline" *ngIf="mandatoryUseHint() as hint">{{ hint }}</p>

          <div class="selected-preview">
            <div class="cards-row selected-order-row" *ngIf="selectedCardsOrdered().length > 0; else emptySelectedPreview">
              <div class="selected-card-stack" *ngFor="let card of selectedCardsOrdered(); let i = index">
                <button type="button" class="order-handle" (click)="moveSelectedCard(card.id, -1)" [disabled]="i === 0">◀</button>
                <img class="card-image compact" [src]="cardImage(card, true)" [alt]="card.label + ' ' + suitLabel(card.suit)" />
                <button type="button" class="order-handle" (click)="moveSelectedCard(card.id, 1)" [disabled]="i === selectedCardsOrdered().length - 1">▶</button>
              </div>
            </div>
            <ng-template #emptySelectedPreview>
              <div class="selected-preview-empty">Nessuna carta selezionata.</div>
            </ng-template>
          </div>
        </section>

        <section class="panel" *ngIf="humanHand() as hand">
          <div class="hand-toolbar">
            <h2>La tua mano</h2>
            <div class="sort-buttons">
              <button type="button" [class.active]="socket.sortMode() === 'rank-asc'" (click)="setSortMode('rank-asc')">Ordina rank +</button>
              <button type="button" [class.active]="socket.sortMode() === 'rank-desc'" (click)="setSortMode('rank-desc')">Ordina rank -</button>
              <button type="button" [class.active]="socket.sortMode() === 'suit'" (click)="setSortMode('suit')">Ordina seme</button>
            </div>
          </div>

          <p class="selection-info">Selezionate: {{ selectedCount() }}</p>

          <div class="cards-row hand">
            <button
              type="button"
              class="card selectable"
              *ngFor="let card of hand"
              [class.selected]="isSelected(card.id)"
              [class.drawn]="isDrawnCard(card.id)"
              [class.mandatory]="isMandatoryDiscardPickCard(card.id)"
              [class.suggested]="isSuggestedMandatoryCard(card.id)"
              (click)="toggleSelection(card.id)"
            >
              <img class="card-image" [src]="cardImage(card, false)" [alt]="card.label + ' ' + suitLabel(card.suit)" />
              <span class="tag" *ngIf="card.isPinella">PIN</span>
              <span class="tag joker" *ngIf="card.isJoker">J</span>
            </button>
          </div>
        </section>
      </section>

      <ng-template #waitingState>
        <p class="waiting">Caricamento tavolo...</p>
      </ng-template>

      <p class="conn">Connessione server: {{ connectionLabel() }}</p>
      <p class="notice-inline" *ngIf="tableNotice() as notice">{{ notice }}</p>
      <p class="conn error" *ngIf="socket.latestError()">{{ socket.latestError() }}</p>
    </main>
  `,
  styles: [
    `
      .table-layout {
        min-height: 100dvh;
        padding: 24px;
        background: linear-gradient(135deg, #113923, #0f2836 60%, #184969);
        color: #f4f7fa;
      }

      .board {
        display: grid;
        gap: 14px;
      }

      .panel {
        border: 1px solid #ffffff33;
        border-radius: 16px;
        padding: 14px;
        background: #ffffff12;
        backdrop-filter: blur(4px);
      }

      .score-panel {
        padding: 10px 12px;
      }

      .players-panel {
        padding: 10px 12px;
      }

      .players-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border: 1px solid #ffffff33;
        border-radius: 10px;
        background: #00000026;
        color: #f4f7fa;
        padding: 8px 10px;
        cursor: pointer;
      }

      .players-toggle h2 {
        margin: 0;
        font-size: 1rem;
      }

      .players-toggle span {
        font-size: 0.82rem;
        color: #d6e8ff;
      }

      .players-strip {
        margin-top: 10px;
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .player-chip {
        border-radius: 12px;
        padding: 10px;
        background: #0000001f;
        border: 1px solid #ffffff22;
        display: grid;
        gap: 8px;
      }

      .player-chip h3,
      .player-chip p {
        margin: 0;
      }

      .player-chip.turn-active {
        box-shadow: 0 0 0 2px #58b6ff66;
        border-color: #58b6ff88;
      }

      .score-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border: 1px solid #ffffff33;
        border-radius: 10px;
        background: #00000026;
        color: #f4f7fa;
        padding: 8px 10px;
        cursor: pointer;
      }

      .score-toggle h2 {
        margin: 0;
        font-size: 1rem;
      }

      .score-toggle span {
        font-size: 0.82rem;
        color: #d6e8ff;
      }

      .scores-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-top: 10px;
      }

      .score-item {
        border: 1px solid #ffffff2f;
        border-radius: 10px;
        background: #00000026;
        padding: 8px;
      }

      .score-item h3,
      .score-item p {
        margin: 0;
      }

      .score-item p {
        margin-top: 4px;
        color: #deebff;
      }

      .turn-badge {
        margin: 10px 0 0;
      }

      .final-hand-summary h2 {
        margin: 0 0 10px;
      }

      .final-win {
        border-color: #5de2a088;
        background: #0f3a2d66;
      }

      .final-loss {
        border-color: #f0b07b66;
        background: #4a2d1f4d;
      }

      .badge {
        margin: 0;
        padding: 8px 10px;
        border-radius: 999px;
        background: #00000033;
        border: 1px solid #ffffff26;
      }

      .draw-info {
        background: #58b6ff2e;
        border-color: #58b6ff77;
      }

      .winner {
        background: #f8e6cc22;
        border-color: #f8e6cc66;
        color: #f8e6cc;
      }

      .arena {
        display: grid;
        gap: 14px;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        align-items: start;
      }

      @media (max-width: 1120px) {
        .arena {
          grid-template-columns: 1fr;
        }
      }

      .instruction {
        margin: 0 0 10px;
        color: #d8e7ff;
        font-size: 0.9rem;
      }

      .discard-area {
        min-height: 320px;
        max-height: 320px;
        overflow: hidden;
      }

      .discard-scroll {
        overflow: hidden;
        max-width: 100%;
        min-height: 214px;
        padding-bottom: 4px;
      }

      .discard-stack {
        position: relative;
        width: 100%;
        padding-top: 34px;
      }

      .discard-pick {
        position: absolute;
        top: 34px;
        border: 1px solid #ffffff33;
        border-radius: 9px;
        padding: 4px;
        background: #0000001e;
        cursor: pointer;
        transform-origin: center bottom;
        transition: left 0.16s ease, transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
      }

      .discard-pick.top-card {
        border-color: #e3b23b;
      }

      .discard-pick.selected {
        box-shadow: 0 0 0 2px #58b6ff;
      }

      .discard-pick.hovered {
        transform: translateY(-8px) scale(1.14);
        box-shadow: 0 14px 20px #00000044;
        border-color: #f8e6cc;
      }

      .discard-pick.pending-card {
        border-style: dashed;
        border-color: #58b6ff99;
      }

      .discard-pick.near-hover {
        transform: translateY(-4px) scale(1.06);
        box-shadow: 0 8px 14px #00000030;
      }

      .discard-card-image {
        width: 54px;
        border-radius: 8px;
      }

      .top-label {
        position: absolute;
        top: -10px;
        right: -2px;
        background: #e3b23b;
        color: #1a1a1a;
        font-size: 0.62rem;
        padding: 2px 5px;
        border-radius: 6px;
      }

      .table-area {
        min-height: 320px;
        max-height: 320px;
        overflow-y: auto;
      }

      .table-head {
        display: grid;
        gap: 8px;
        margin-bottom: 10px;
      }

      .table-head h2 {
        margin: 0;
      }

      .owner-filters {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .owner-filters button {
        border: 1px solid #ffffff44;
        border-radius: 999px;
        background: #0000002b;
        color: #f4f7fa;
        padding: 5px 9px;
      }

      .owner-filters button.active {
        border-color: #58b6ff;
        box-shadow: 0 0 0 1px #58b6ff;
      }

      .bot-move {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .move-icon {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: #f8e6cc2d;
        border: 1px solid #f8e6cc66;
      }

      .back-cards {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .card-back-mini {
        width: 26px;
        border-radius: 4px;
      }

      .meld-grid {
        display: grid;
        gap: 10px;
      }

      .meld {
        border-radius: 12px;
        background: #00000024;
        border: 1px solid #ffffff1f;
        padding: 10px;
      }

      .meld.targetable {
        cursor: pointer;
      }

      .meld.target-blocked {
        opacity: 0.7;
      }

      .meld.target-selected {
        box-shadow: 0 0 0 2px #58b6ff;
      }

      .meld-title-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }

      .meld-title-row p {
        margin: 0;
      }

      .meld-value {
        border-radius: 999px;
        border: 1px solid #ffffff44;
        padding: 2px 8px;
        font-size: 0.8rem;
        color: #def0ff;
        background: #00000020;
      }

      .meld-target-label {
        margin: 8px 0 0;
        color: #d3ebff;
        font-size: 0.85rem;
      }

      .last-bot-meld {
        box-shadow: 0 0 0 2px #58b6ff55;
      }

      .cards-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .meld-card-slot {
        position: relative;
      }

      .wild-badge {
        position: absolute;
        top: -9px;
        right: -8px;
        min-width: 20px;
        height: 20px;
        border-radius: 999px;
        border: 1px solid #ffffff66;
        background: #0f1a25;
        color: #f8e6cc;
        display: grid;
        place-items: center;
        font-size: 0.72rem;
        line-height: 1;
      }

      .card {
        width: 78px;
        height: 116px;
        border-radius: 10px;
        border: 1px solid #d6d6d6;
        background: #fff;
        position: relative;
        padding: 0;
      }

      .card-image {
        width: 76px;
        border-radius: 9px;
        display: block;
      }

      .card-image.compact {
        width: 46px;
        border-radius: 7px;
      }

      .card-image.micro {
        width: 30px;
        border-radius: 5px;
      }

      .tag {
        position: absolute;
        bottom: 4px;
        right: 4px;
        font-size: 0.62rem;
        padding: 2px 4px;
        border-radius: 4px;
        background: #dde8ff;
        color: #22385d;
      }

      .tag.joker {
        background: #ffe8c4;
        color: #734c0d;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .howto {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 4px;
      }

      .howto span {
        font-size: 0.84rem;
        border: 1px dashed #ffffff44;
        border-radius: 999px;
        padding: 4px 8px;
        background: #00000021;
      }

      .action {
        border: 1px solid #f8e6cc66;
        border-radius: 10px;
        color: #f4f7fa;
        background: #0000002b;
        padding: 10px 14px;
        cursor: pointer;
      }

      .action.clear {
        border-color: #ffffff40;
      }

      .action.restart {
        border-color: #e3b23b88;
      }

      .action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .selected-preview {
        width: 100%;
        margin-top: 8px;
        min-height: 120px;
      }

      .selected-order-row {
        align-items: flex-end;
        min-height: 78px;
      }

      .selected-card-stack {
        display: grid;
        gap: 6px;
        justify-items: center;
      }

      .selected-preview-empty {
        min-height: 78px;
        display: flex;
        align-items: center;
        color: #d9ebff;
        opacity: 0.8;
      }

      .order-handle {
        border: 1px solid #ffffff44;
        border-radius: 999px;
        background: #0000002b;
        color: #f4f7fa;
        width: 28px;
        height: 28px;
      }

      .order-handle:disabled {
        opacity: 0.35;
      }

      .hand-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .sort-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .sort-buttons button {
        border: 1px solid #ffffff44;
        border-radius: 8px;
        background: #0000002b;
        color: #f4f7fa;
        padding: 6px 10px;
      }

      .sort-buttons button.active {
        border-color: #58b6ff;
      }

      .selection-info {
        margin: 8px 0;
        color: #d9ebff;
      }

      .hand {
        margin-top: 10px;
      }

      .selectable {
        cursor: pointer;
      }

      .selectable.selected {
        transform: translateY(-7px);
        box-shadow: 0 0 0 2px #58b6ff;
      }

      .selectable.drawn {
        box-shadow: 0 0 0 3px #e3b23b;
      }

      .selectable.mandatory {
        box-shadow: 0 0 0 3px #f4ad4a;
      }

      .selectable.suggested:not(.mandatory) {
        box-shadow: 0 0 0 2px #6ac8ff;
      }

      .empty {
        opacity: 0.8;
      }

      .waiting {
        margin-top: 20px;
        color: #e3ebf7;
      }

      .conn {
        margin-top: 24px;
        color: #d3dfef;
      }

      .error {
        color: #ffd2d2;
      }

      .error-inline {
        width: 100%;
        margin: 8px 0 0;
        border: 1px solid #ff7c7c;
        border-radius: 10px;
        padding: 8px 10px;
        background: #600f0f66;
        color: #ffd2d2;
      }

      .hint-inline {
        width: 100%;
        margin: 8px 0 0;
        border: 1px solid #ffd27a;
        border-radius: 10px;
        padding: 8px 10px;
        background: #5a451666;
        color: #ffe9c1;
      }

      .notice-inline {
        margin: 8px 0 0;
        border: 1px solid #68d598;
        border-radius: 10px;
        padding: 8px 10px;
        background: #134b2f80;
        color: #d8ffe8;
      }

      .lobby-panel h2,
      .lobby-panel p {
        margin: 0;
      }

      .lobby-players {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0;
      }

      .lobby-players span {
        border: 1px solid #ffffff33;
        border-radius: 999px;
        padding: 5px 10px;
        background: #00000022;
      }
    `,
  ],
})
export class TablePageComponent {
  readonly tableId: string;
  readonly playerId: string;
  readonly connectionLabel = computed(() => (this.socket.connected() ? 'online' : 'offline'));
  readonly selectedCards = signal<string[]>([]);
  readonly selectedDiscardCardId = signal<string | null>(null);
  readonly selectedOwnerPlayerId = signal<string>('');
  readonly selectedTargetMeldId = signal<string | null>(null);
  readonly scorePanelOpen = signal(false);
  readonly playersPanelOpen = signal(false);
  readonly hoveredDiscardIndex = signal<number | null>(null);
  readonly tableNotice = signal<string | null>(null);

  private readonly imageCache = new Map<string, string>();
  private backImage: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly humanHand = computed(() => {
    const game = this.socket.table()?.game;
    if (!game) {
      return [];
    }

    const you = game.players.find((player) => player.playerId === this.playerId);
    return you ? this.socket.getSortedHand(you.hand) : [];
  });

  readonly selectedCardsOrdered = computed(() => {
    const handById = new Map(this.humanHand().map((card) => [card.id, card]));
    return this.selectedCards().map((id) => handById.get(id)).filter((card): card is GameCardView => Boolean(card));
  });

  readonly mandatoryUseSuggestedCardIds = computed(() => {
    const game = this.socket.table()?.game;
    if (!game || game.turnPlayerId !== this.playerId || game.finished) {
      return [] as string[];
    }

    const requiredId = game.turnMustUseDiscardPickCardId;
    if (!requiredId) {
      return [] as string[];
    }

    const hand = this.humanHand();
    const required = hand.find((card) => card.id === requiredId);
    if (!required) {
      return [] as string[];
    }

    const sameRankNaturals = hand.filter(
      (card) =>
        card.id !== required.id &&
        !card.isJoker &&
        !card.isPinella &&
        card.rank === required.rank &&
        card.suit !== required.suit,
    );
    const wildcards = hand.filter((card) => card.id !== required.id && (card.isJoker || card.isPinella));

    const helpers = [...sameRankNaturals, ...wildcards].slice(0, 2);
    return [required.id, ...helpers.map((card) => card.id)];
  });

  readonly mandatoryUseHint = computed(() => {
    const game = this.socket.table()?.game;
    if (!game || game.turnPlayerId !== this.playerId || game.finished) {
      return null;
    }

    const requiredId = game.turnMustUseDiscardPickCardId;
    if (!requiredId) {
      return null;
    }

    const hand = this.humanHand();
    const required = hand.find((card) => card.id === requiredId);
    if (!required) {
      return null;
    }

    const suggested = this.mandatoryUseSuggestedCardIds();
    if (suggested.length >= 3) {
      return `Carta del pozzo obbligatoria: usa ${required.label}${this.suitLabel(required.suit)}. Suggerimento: prova un tris con le carte evidenziate.`;
    }

    return `Carta del pozzo obbligatoria: devi usare ${required.label}${this.suitLabel(required.suit)} in una combinazione prima di poter scartare.`;
  });

  constructor(route: ActivatedRoute, readonly socket: GameSocketService, private readonly router: Router) {
    this.tableId = route.snapshot.paramMap.get('tableId') ?? 'unknown';
    this.playerId = route.snapshot.queryParamMap.get('playerId') ?? 'p1';
    const displayName = localStorage.getItem('pinnacolo-display-name') ?? this.playerId;

    this.socket.connect();
    this.socket.joinTable(this.tableId, this.playerId, displayName);
    this.socket.refreshTable(this.tableId);

    effect(() => {
      const notice = this.socket.latestNotice();
      if (!notice || notice.tableId !== this.tableId) {
        return;
      }

      this.tableNotice.set(notice.message);
      if (this.noticeTimer) {
        clearTimeout(this.noticeTimer);
      }

      this.noticeTimer = setTimeout(() => {
        this.tableNotice.set(null);
      }, 4000);
    });

    effect(() => {
      const deleted = this.socket.deletedTable();
      if (!deleted || deleted.tableId !== this.tableId) {
        return;
      }

      this.tableNotice.set(deleted.message);
      void this.router.navigate(['/']);
    });
  }

  isTableOwner(ownerPlayerId: string | null) {
    return ownerPlayerId === this.playerId;
  }

  canStartFromTableScreen(status: string, playersCount: number, targetPlayers: number) {
    return status === 'waiting' && playersCount === targetPlayers;
  }

  startFromTableScreen() {
    this.socket.startTable(this.tableId, this.playerId);
  }

  selectedCount() {
    return this.selectedCards().length;
  }

  drawFromStock() {
    this.socket.drawFromStock(this.tableId, this.playerId);
    this.selectedDiscardCardId.set(null);
  }

  pickDiscardPile() {
    const game = this.socket.table()?.game;
    if (!game || game.discardPile.length === 0) {
      return;
    }

    const selected = this.selectedDiscardCardId() ?? game.discardPile[game.discardPile.length - 1].id;
    this.socket.pickDiscardPile(this.tableId, this.playerId, selected);
    this.selectedDiscardCardId.set(null);
  }

  selectDiscardCard(cardId: string) {
    this.selectedDiscardCardId.set(cardId);
  }

  setDiscardHover(index: number) {
    this.hoveredDiscardIndex.set(index);
  }

  clearDiscardHover() {
    this.hoveredDiscardIndex.set(null);
  }

  discardStackHeight(count: number) {
    if (count <= 0) {
      return 0;
    }

    return 120;
  }

  discardOffset(index: number, total: number) {
    const hovered = this.hoveredDiscardIndex();
    if (hovered === null) {
      return index * 26;
    }

    if (index < hovered) {
      return index * 22;
    }

    if (index === hovered) {
      return hovered * 22;
    }

    return hovered * 22 + 56 + (index - hovered - 1) * 40;
  }

  discardZIndex(index: number, total: number) {
    const hovered = this.hoveredDiscardIndex();
    if (hovered === null) {
      return index + 1;
    }

    if (index === hovered) {
      return total + 10;
    }

    if (Math.abs(index - hovered) === 1) {
      return total + 5 - Math.abs(index - hovered);
    }

    return index + 1;
  }

  isNearHoveredDiscard(index: number) {
    const hovered = this.hoveredDiscardIndex();
    return hovered !== null && Math.abs(index - hovered) === 1;
  }

  playSelectedMeld() {
    const orderedIds = this.selectedCardsOrdered().map((card) => card.id);
    this.socket.playMeld(this.tableId, this.playerId, orderedIds);
    this.clearSelection();
  }

  attachSelectedToMeld() {
    const meldId = this.selectedTargetMeldId();
    if (!meldId) {
      return;
    }

    const orderedIds = this.selectedCardsOrdered().map((card) => card.id);
    this.socket.attachToMeld(this.tableId, this.playerId, meldId, orderedIds);
    this.clearSelection();
  }

  endMeld() {
    this.socket.endMeld(this.tableId, this.playerId);
    this.clearSelection();
  }

  discardSelectedCard() {
    const selected = this.selectedCards();
    if (selected.length !== 1) {
      return;
    }

    this.socket.discardCard(this.tableId, this.playerId, selected[0]);
    this.clearSelection();
  }

  setSortMode(mode: HandSortMode) {
    this.socket.setSortMode(mode);
  }

  toggleSelection(cardId: string) {
    const current = this.selectedCards();
    if (current.includes(cardId)) {
      this.selectedCards.set(current.filter((id) => id !== cardId));
      return;
    }

    this.selectedCards.set(this.insertByHandOrder(current, cardId));
  }

  moveSelectedCard(cardId: string, direction: -1 | 1) {
    const current = [...this.selectedCards()];
    const index = current.indexOf(cardId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
      return;
    }

    const [card] = current.splice(index, 1);
    current.splice(nextIndex, 0, card);
    this.selectedCards.set(current);
  }

  clearSelection() {
    this.selectedCards.set([]);
  }

  toggleScorePanel() {
    this.scorePanelOpen.update((open) => !open);
  }

  togglePlayersPanel() {
    this.playersPanelOpen.update((open) => !open);
  }

  restartGame() {
    this.socket.startTable(this.tableId, this.playerId);
    this.clearSelection();
    this.selectedTargetMeldId.set(null);
    this.selectedDiscardCardId.set(null);
  }

  isSelected(cardId: string) {
    return this.selectedCards().includes(cardId);
  }

  selectOwnerPlayer(playerId: string) {
    this.selectedOwnerPlayerId.set(playerId);
    this.selectedTargetMeldId.set(null);
  }

  visibleMelds(game: GameStateView) {
    const owner = this.selectedOwnerPlayerId() || this.playerId;
    return game.melds.filter((meld) => meld.ownerPlayerId === owner);
  }

  toggleTargetMeld(game: GameStateView, meld: MeldView) {
    if (!this.canTargetMeld(game, meld)) {
      return;
    }

    const current = this.selectedTargetMeldId();
    this.selectedTargetMeldId.set(current === meld.id ? null : meld.id);
  }

  canAttachSelected(game: GameStateView) {
    if (!this.canAct(game.phase, 'meld')) {
      return false;
    }

    const target = this.selectedTargetMeld(game);
    if (!target) {
      return false;
    }

    if (target.ownerPlayerId === this.playerId) {
      return this.selectedCount() >= 1;
    }

    if (!this.meldHasWildcard(target) || this.selectedCount() !== 1) {
      return false;
    }

    const selected = this.selectedCardsOrdered()[0];
    return Boolean(selected && !selected.isJoker && !selected.isPinella);
  }

  canTargetMeld(game: GameStateView, meld: MeldView) {
    if (!this.canAct(game.phase, 'meld')) {
      return false;
    }

    if (meld.ownerPlayerId === this.playerId) {
      return true;
    }

    return this.meldHasWildcard(meld);
  }

  selectedTargetMeld(game: GameStateView) {
    const targetId = this.selectedTargetMeldId();
    if (!targetId) {
      return null;
    }

    return game.melds.find((meld) => meld.id === targetId) ?? null;
  }

  meldHasWildcard(meld: MeldView) {
    return meld.cards.some((card) => card.isJoker || card.isPinella);
  }

  canAct(phase: string, requiredPhase: 'draw-or-pick' | 'meld' | 'discard') {
    const game = this.socket.table()?.game;
    if (!game) {
      return false;
    }

    return !game.finished && game.turnPlayerId === this.playerId && phase === requiredPhase;
  }

  canDiscard(phase: string) {
    const game = this.socket.table()?.game;
    if (!game) {
      return false;
    }

    return !game.finished && game.turnPlayerId === this.playerId && (phase === 'meld' || phase === 'discard');
  }

  suitLabel(suit: GameCardView['suit']) {
    if (suit === 'clubs') return 'C';
    if (suit === 'diamonds') return 'D';
    if (suit === 'hearts') return 'H';
    if (suit === 'spades') return 'S';
    return '*';
  }

  isRedSuit(suit: GameCardView['suit']) {
    return suit === 'hearts' || suit === 'diamonds';
  }

  isHumanTurn(game: GameStateView) {
    return game.turnPlayerId === this.playerId;
  }

  isDrawnCard(cardId: string) {
    const game = this.socket.table()?.game;
    if (!game || game.turnPlayerId !== this.playerId) {
      return false;
    }

    return game.turnDrawnCardIds.includes(cardId);
  }

  isMandatoryDiscardPickCard(cardId: string) {
    const game = this.socket.table()?.game;
    return Boolean(game && game.turnPlayerId === this.playerId && game.turnMustUseDiscardPickCardId === cardId);
  }

  isSuggestedMandatoryCard(cardId: string) {
    return this.mandatoryUseSuggestedCardIds().includes(cardId);
  }

  isLastMoveBy(game: GameStateView, playerId: string) {
    return game.lastMove?.playerId === playerId;
  }

  playerDisplayName(playerId: string) {
    if (playerId === this.playerId) {
      return 'ME';
    }

    const table = this.socket.table();
    const found = table?.players.find((player) => player.playerId === playerId);
    return found?.displayName ?? playerId;
  }

  lastMoveIcon(game: GameStateView) {
    const kind = game.lastMove?.kind;
    if (kind === 'draw-stock') return 'M';
    if (kind === 'pick-discard') return 'P';
    if (kind === 'play-meld') return 'C';
    if (kind === 'attach-meld') return 'A';
    if (kind === 'discard') return 'S';
    return '-';
  }

  lastMoveCards(game: GameStateView) {
    if (game.lastMove?.kind === 'draw-stock' && game.lastMove.playerId !== this.playerId) {
      return [];
    }

    const ids = game.lastMove?.cardIds ?? [];
    if (ids.length === 0) {
      return [];
    }

    return this.resolveCardsByIds(game, ids);
  }

  isLastBotMeld(game: GameStateView, ownerPlayerId: string, meldCards: GameCardView[]) {
    const last = game.lastMove;
    if (!last || (last.kind !== 'play-meld' && last.kind !== 'attach-meld') || last.playerId !== ownerPlayerId) {
      return false;
    }

    const meldIds = new Set(meldCards.map((card) => card.id));
    return last.cardIds.some((id) => meldIds.has(id));
  }

  wildcardAssignedSuit(meld: MeldView, card: GameCardView) {
    if (!card.isJoker && !card.isPinella) {
      return null;
    }

    return meld.wildcardAssignments?.[card.id] ?? null;
  }

  wildcardReplacementText(meld: MeldView, card: GameCardView) {
    const suit = this.wildcardAssignedSuit(meld, card);
    if (!suit) {
      return null;
    }

    if (meld.type === 'set') {
      const natural = meld.cards.find((entry) => !entry.isJoker && !entry.isPinella);
      const rankLabel = natural?.label ?? '?';
      return `${rankLabel}${this.suitBadgeSymbol(suit)}`;
    }

    return this.suitBadgeSymbol(suit);
  }

  suitBadgeSymbol(suit: GameCardView['suit']) {
    if (suit === 'hearts') return '♥';
    if (suit === 'diamonds') return '♦';
    if (suit === 'clubs') return '♣';
    if (suit === 'spades') return '♠';
    return '?';
  }

  meldValue(meld: MeldView) {
    const completeRunScore = this.completeRunScore(meld);
    if (completeRunScore > 0) {
      return completeRunScore;
    }

    const base = meld.cards.reduce((acc, card) => acc + this.cardPoints(card), 0);
    const hasWildcard = meld.cards.some((card) => card.isJoker || card.isPinella);
    const lengthMultiplier = meld.cards.length >= 6 && !hasWildcard ? 2 : 1;
    const pokerMultiplier = this.isPoker(meld) ? 2 : 1;
    return base * lengthMultiplier * pokerMultiplier;
  }

  scoreRows(game: GameStateView) {
    return game.players.map((player) => {
      const ownedMelds = game.melds.filter((meld) => meld.ownerPlayerId === player.playerId);
      const meldPoints = ownedMelds.reduce((total, meld) => total + this.meldValue(meld), 0);
      const handPoints = player.hand.reduce((total, card) => total + this.cardPoints(card), 0);
      return {
        playerId: player.playerId,
        meldPoints,
        handPoints,
        partial: meldPoints - handPoints,
      };
    });
  }

  tableScoreRows(table: { tableScores?: Record<string, number> }, game: GameStateView) {
    const totals = table.tableScores ?? {};
    return game.players
      .map((player) => ({
        playerId: player.playerId,
        total: totals[player.playerId] ?? 0,
      }))
      .sort((a, b) => b.total - a.total);
  }

  cardImage(card: GameCardView, compact: boolean) {
    const key = `${card.id}-${compact ? 'c' : 'n'}`;
    const cached = this.imageCache.get(key);
    if (cached) {
      return cached;
    }

    const width = compact ? 72 : 152;
    const height = compact ? 104 : 228;
    const data = this.renderCardImage(card, width, height);
    this.imageCache.set(key, data);
    return data;
  }

  cardBackImage() {
    if (this.backImage) {
      return this.backImage;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 104;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return '';
    }

    ctx.fillStyle = '#c30f63';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#f4c8dc';
    ctx.lineWidth = 1;
    for (let i = -50; i < 130; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 60, 60);
      ctx.stroke();
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    this.backImage = canvas.toDataURL('image/jpeg', 0.92);
    return this.backImage;
  }

  previewBackCards(count: number) {
    return new Array(Math.min(count, 6)).fill(0);
  }

  private cardPoints(card: GameCardView) {
    if (card.isJoker) {
      return 25;
    }

    if (card.isPinella) {
      return 20;
    }

    if (card.rank === 1) {
      return 15;
    }

    if (card.rank >= 2 && card.rank <= 6) {
      return 5;
    }

    if (card.rank >= 7 && card.rank <= 13) {
      return 10;
    }

    return 0;
  }

  private isPokerDiTre(meld: MeldView) {
    if (meld.type !== 'set' || meld.cards.length !== 4) {
      return false;
    }

    const naturals = meld.cards.filter((card) => !card.isJoker && !card.isPinella);
    return naturals.length > 0 && naturals.every((card) => card.rank === 3);
  }

  private isPoker(meld: MeldView) {
    return meld.type === 'set' && meld.cards.length === 4;
  }

  displayedDiscardPile(game: GameStateView) {
    if (!this.shouldShowPendingDiscard(game)) {
      return game.discardPile;
    }

    return [...game.discardPile, this.pendingDiscardCard(game)];
  }

  isPendingDiscardCard(card: GameCardView) {
    return card.id.startsWith('pending-discard-');
  }

  private shouldShowPendingDiscard(game: GameStateView) {
    return !game.finished && (game.phase === 'meld' || game.phase === 'discard');
  }

  private pendingDiscardCard(game: GameStateView): GameCardView {
    return {
      id: `pending-discard-${game.turnPlayerId}`,
      rank: 0,
      suit: 'spades',
      label: '?',
      isJoker: false,
      isPinella: false,
    };
  }

  private completeRunScore(meld: MeldView) {
    if (meld.type !== 'run') {
      return 0;
    }

    const naturals = meld.cards.filter((card) => !card.isJoker && !card.isPinella);
    const suit = naturals[0]?.suit;
    if (!suit || (suit !== 'clubs' && suit !== 'spades' && suit !== 'hearts' && suit !== 'diamonds')) {
      return 0;
    }

    // Pinnacolo applies only to red suits (hearts/diamonds).
    if (suit !== 'hearts' && suit !== 'diamonds') {
      return 0;
    }

    const fullLength = 13;
    const aceToAceLength = fullLength + 1;

    if (meld.cards.length === aceToAceLength) {
      return 1000;
    }

    if (meld.cards.length === fullLength) {
      return 500;
    }

    return 0;
  }

  private renderCardImage(card: GameCardView, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return '';
    }

    const isRed = this.isRedSuit(card.suit);
    const color = isRed ? '#cf123f' : '#21252b';
    const symbol = this.cardSymbol(card);
    const isFullCard = width >= 100;
    const cornerSymbolSize = Math.floor(height * (isFullCard ? 0.2 : 0.17));
    const cornerLabelSize = Math.floor(height * 0.13);
    const cornerX = isFullCard ? 12 : 8;
    const topLabelY = isFullCard ? 22 : 18;
    const topCornerY = isFullCard ? 50 : 40;
    const bottomLabelY = isFullCard ? 4 : 0;
    const bottomCornerY = isFullCard ? 30 : 22;
    const bottomCornerInset = isFullCard ? 12 : 10;

    ctx.fillStyle = '#ffffff';
    this.roundRect(ctx, 1, 1, width - 2, height - 2, 10);
    ctx.fill();

    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 1;
    this.roundRect(ctx, 1, 1, width - 2, height - 2, 10);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = `${cornerLabelSize}px Georgia, serif`;
    ctx.fillText(card.label, cornerX, topLabelY);
    ctx.font = `${cornerSymbolSize}px Georgia, serif`;
    ctx.fillText(symbol, cornerX, topCornerY);

    ctx.save();
    ctx.translate(width - bottomCornerInset, height - bottomCornerInset);
    ctx.rotate(Math.PI);
    ctx.fillStyle = color;
    ctx.font = `${cornerLabelSize}px Georgia, serif`;
    ctx.fillText(card.label, 0, bottomLabelY);
    ctx.font = `${cornerSymbolSize}px Georgia, serif`;
    ctx.fillText(symbol, 0, bottomCornerY);
    ctx.restore();

    if (card.isJoker) {
      ctx.fillStyle = '#cf123f';
      ctx.font = `${Math.floor(height * 0.14)}px Georgia, serif`;
      ctx.fillText('JOLLY', 8, 18);
      ctx.font = `${Math.floor(height * 0.24)}px Segoe UI Emoji, serif`;
      ctx.fillText('🃏', width / 2 - 14, height / 2 + 12);
      return canvas.toDataURL('image/jpeg', 0.92);
    }

    const centerX = width / 2;
    const centerY = height / 2 + 4;
    if (['J', 'Q', 'K'].includes(card.label)) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      const frameW = width * 0.46;
      const frameH = height * 0.46;
      this.roundRect(ctx, centerX - frameW / 2, centerY - frameH / 2, frameW, frameH, 0);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `${Math.floor(height * 0.26)}px Georgia, serif`;
      ctx.fillText(card.label, centerX - 10, centerY + 8);
      ctx.font = `${Math.floor(height * 0.11)}px Georgia, serif`;
      ctx.fillText(symbol, centerX - 5, centerY + 22);
    } else {
      ctx.fillStyle = color;
      ctx.font = `${Math.floor(height * 0.26)}px Georgia, serif`;
      ctx.fillText(symbol, centerX - 10, centerY + 8);
    }

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  private cardSymbol(card: GameCardView) {
    if (card.isJoker) return '*';
    if (card.suit === 'hearts') return '♥';
    if (card.suit === 'diamonds') return '♦';
    if (card.suit === 'clubs') return '♣';
    return '♠';
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private cardDisplayValue(card: GameCardView, aceLowMode: boolean) {
    if (card.isJoker) {
      return 100;
    }

    if (card.isPinella) {
      return aceLowMode ? 2 : 11;
    }

    if (card.rank === 1) {
      return aceLowMode ? 1 : 14;
    }

    return card.rank;
  }

  private shouldUseAceLowOrdering(cards: GameCardView[]) {
    const naturals = cards.filter((card) => !card.isJoker && !card.isPinella);
    const hasAce = naturals.some((card) => card.rank === 1);
    const hasLowBridge = naturals.some((card) => card.rank >= 3 && card.rank <= 4);
    const hasFaceOrTen = naturals.some((card) => card.rank >= 10 || card.rank === 13);
    return hasAce && hasLowBridge && !hasFaceOrTen;
  }

  private insertByHandOrder(current: string[], cardId: string) {
    const hand = this.humanHand();
    const handOrder = new Map(hand.map((card, index) => [card.id, index]));
    const next = [...current, cardId];
    return next.sort((left, right) => (handOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (handOrder.get(right) ?? Number.MAX_SAFE_INTEGER));
  }

  private resolveCardsByIds(game: GameStateView, ids: string[]) {
    const allCards = [
      ...game.stock,
      ...game.discardPile,
      ...game.melds.flatMap((meld) => meld.cards),
      ...game.players.flatMap((player) => player.hand),
    ];
    const map = new Map(allCards.map((card) => [card.id, card]));
    return ids.map((id) => map.get(id)).filter((card): card is GameCardView => Boolean(card));
  }
}
