import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

export type CardSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades' | 'joker';

export interface GameCardView {
  id: string;
  rank: number;
  suit: CardSuit;
  label: string;
  isJoker: boolean;
  isPinella: boolean;
}

export interface GamePlayerView {
  playerId: string;
  seat: number;
  teammateSeat: number;
  isBot: boolean;
  hand: GameCardView[];
  opened: boolean;
}

export interface MeldView {
  id: string;
  type: 'set' | 'run';
  ownerPlayerId: string;
  cards: GameCardView[];
  wildcardAssignments?: Record<string, CardSuit>;
}

export interface GameMoveView {
  playerId: string;
  kind: 'draw-stock' | 'pick-discard' | 'play-meld' | 'attach-meld' | 'end-meld' | 'discard';
  cardIds: string[];
}

export interface GameStateView {
  tableId: string;
  handNumber: number;
  started: boolean;
  finished: boolean;
  winnerPlayerId: string | null;
  turnPlayerId: string;
  phase: 'draw-or-pick' | 'meld' | 'discard';
  turnDrawnCardIds: string[];
  turnMustUseDiscardPickCardId: string | null;
  turnMustReuseWildcardCardIds: string[];
  turnMustReuseWildcardMeldId: string | null;
  lastMove: GameMoveView | null;
  stock: GameCardView[];
  discardPile: GameCardView[];
  melds: MeldView[];
  players: GamePlayerView[];
}

export interface LobbyPlayerView {
  playerId: string;
  displayName: string;
  seat: number;
  isBot: boolean;
}

export interface TableSummaryView {
  tableId: string;
  status: 'waiting' | 'playing' | 'finished';
  ownerPlayerId: string | null;
  ownerDisplayName: string | null;
  targetPlayers: number;
  playersCount: number;
  humansCount: number;
  botsCount: number;
  maxPlayers: number;
}

export interface TableStateView {
  tableId: string;
  status: 'waiting' | 'playing' | 'finished';
  ownerPlayerId: string | null;
  targetPlayers: number;
  players: LobbyPlayerView[];
  game: GameStateView | null;
  tableScores: Record<string, number>;
  completedHands: number;
}

export interface TableNoticeView {
  tableId: string;
  kind: 'player-joined';
  message: string;
  playerId: string;
  displayName: string;
}

export interface TableDeletedView {
  tableId: string;
  message: string;
}

export type HandSortMode = 'rank-asc' | 'rank-desc' | 'suit';

@Injectable({ providedIn: 'root' })
export class GameSocketService {
  private socket: Socket | null = null;
  private readonly baseUrl = environment.apiUrl;
  private connectErrorCount = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private currentSession: { tableId: string; playerId: string; displayName: string } | null = null;

  readonly connected = signal(false);
  readonly latestError = signal<string | null>(null);
  readonly latestNotice = signal<TableNoticeView | null>(null);
  readonly deletedTable = signal<TableDeletedView | null>(null);
  readonly tables = signal<TableSummaryView[]>([]);
  readonly table = signal<TableStateView | null>(null);
  readonly sortMode = signal<HandSortMode>('rank-asc');

  connect() {
    if (this.socket) {
      return;
    }

    this.socket = io(`${this.baseUrl}/game`, {
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      this.connectErrorCount = 0;
      this.connected.set(true);
      this.latestError.set(null);
      this.socket?.emit('tables:list');

      if (this.currentSession) {
        this.socket?.emit('table:join', {
          tableId: this.currentSession.tableId,
          playerId: this.currentSession.playerId,
          displayName: this.currentSession.displayName,
        });
        this.socket?.emit('table:state', { tableId: this.currentSession.tableId });
      }
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('connect_error', () => {
      this.connectErrorCount += 1;
      this.connected.set(false);
      if (this.connectErrorCount >= 2) {
        this.latestError.set('Connessione al server non riuscita, riprovo...');
      }
    });
    this.socket.on('tables:update', (payload: TableSummaryView[]) => this.tables.set(payload));
    this.socket.on('table:update', (payload: TableStateView) => this.table.set(payload));
    this.socket.on('table:notice', (payload: TableNoticeView) => this.latestNotice.set(payload));
    this.socket.on('table:deleted', (payload: TableDeletedView) => {
      if (this.table()?.tableId === payload.tableId) {
        this.table.set(null);
      }
      this.deletedTable.set(payload);
      this.latestError.set(payload.message);
    });
    this.socket.on('command:error', (payload: { message: string }) => {
      this.latestError.set(payload.message);
    });

    this.socket.emit('tables:list');
    this.startKeepAlive();
  }

  joinTable(tableId: string, playerId: string, displayName: string) {
    this.latestError.set(null);
    this.currentSession = { tableId, playerId, displayName };
    this.socket?.emit('table:join', { tableId, playerId, displayName }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && response?.error) {
        this.latestError.set(response.error);
      }
    });
    this.socket?.emit('table:state', { tableId });
    this.socket?.emit('tables:list');
  }

  createTable(tableId: string, ownerPlayerId: string, ownerDisplayName: string, targetPlayers: number) {
    this.latestError.set(null);
    this.socket?.emit('table:create', { tableId, ownerPlayerId, ownerDisplayName, targetPlayers }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && response?.error) {
        this.latestError.set(response.error);
      }
    });
    this.socket?.emit('tables:list');
  }

  addBot(tableId: string) {
    this.latestError.set(null);
    this.socket?.emit('table:add-bot', { tableId }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && response?.error) {
        this.latestError.set(response.error);
      }
    });
    this.socket?.emit('table:state', { tableId });
    this.socket?.emit('tables:list');
  }

  startTable(tableId: string, playerId: string) {
    this.latestError.set(null);
    this.socket?.emit('table:start', { tableId, playerId }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && response?.error) {
        this.latestError.set(response.error);
      }
    });
    this.socket?.emit('table:state', { tableId });
    this.socket?.emit('tables:list');
  }

  deleteTable(tableId: string, playerId: string) {
    this.latestError.set(null);
    this.deletedTable.set(null);
    this.socket?.emit('table:delete', { tableId, playerId }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && response?.error) {
        this.latestError.set(response.error);
      }
    });

    if (this.currentSession?.tableId === tableId && this.currentSession.playerId === playerId) {
      this.currentSession = null;
    }
    this.socket?.emit('tables:list');
  }

  drawFromStock(tableId: string, playerId: string) {
    this.sendCommand(tableId, {
      type: 'draw-from-stock',
      playerId,
    });
  }

  pickDiscardPile(tableId: string, playerId: string, discardPickCardId?: string) {
    this.sendCommand(tableId, {
      type: 'pick-discard-pile',
      playerId,
      payload: {
        discardPickCardId,
      },
    });
  }

  playMeld(tableId: string, playerId: string, cardIds: string[]) {
    this.sendCommand(tableId, {
      type: 'play-meld',
      playerId,
      payload: {
        cardIds,
      },
    });
  }

  attachToMeld(tableId: string, playerId: string, meldId: string, cardIds: string[]) {
    this.sendCommand(tableId, {
      type: 'attach-to-meld',
      playerId,
      payload: {
        meldId,
        cardIds,
      },
    });
  }

  endMeld(tableId: string, playerId: string) {
    this.sendCommand(tableId, {
      type: 'end-meld',
      playerId,
    });
  }

  discardCard(tableId: string, playerId: string, discardCardId: string) {
    this.sendCommand(tableId, {
      type: 'discard-card',
      playerId,
      payload: {
        discardCardId,
      },
    });
  }

  setSortMode(mode: HandSortMode) {
    this.sortMode.set(mode);
  }

  getSortedHand(hand: GameCardView[]): GameCardView[] {
    const mode = this.sortMode();
    const suitOrder: Record<CardSuit, number> = {
      clubs: 0,
      diamonds: 1,
      hearts: 2,
      spades: 3,
      joker: 4,
    };

    const cards = [...hand];
    if (mode === 'rank-asc') {
      return cards.sort((a, b) => a.rank - b.rank || suitOrder[a.suit] - suitOrder[b.suit]);
    }

    if (mode === 'rank-desc') {
      return cards.sort((a, b) => b.rank - a.rank || suitOrder[a.suit] - suitOrder[b.suit]);
    }

    return cards.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || a.rank - b.rank);
  }

  private sendCommand(
    tableId: string,
    command: {
      type: string;
      playerId: string;
      payload?: { cardIds?: string[]; discardCardId?: string; discardPickCardId?: string; meldId?: string };
    },
  ) {
    this.latestError.set(null);
    this.socket?.emit('table:command', { tableId, command }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && response?.error) {
        this.latestError.set(response.error);
      }
    });
  }

  refreshTable(tableId: string) {
    this.socket?.emit('table:state', { tableId });
  }

  refreshTables() {
    this.socket?.emit('tables:list');
  }

  private startKeepAlive() {
    if (this.keepAliveTimer) {
      return;
    }

    this.keepAliveTimer = setInterval(() => {
      this.socket?.emit('tables:list');
      if (this.currentSession) {
        this.socket?.emit('table:state', { tableId: this.currentSession.tableId });
      }
    }, 45_000);
  }
}
