import { OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameEngineService } from '../engine/game-engine.service';
import { TableStateStoreService } from '../persistence/table-state-store.service';
import { GameCard, GameCommand, Meld, TableState } from '../domain/types';

interface TableSummary {
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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;

  private tables = new Map<string, TableState>();
  private botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly minPlayersToStart = 2;
  private readonly maxPlayers = 4;

  constructor(
    private readonly engine: GameEngineService,
    private readonly tableStateStore: TableStateStoreService,
  ) {}

  async onModuleInit() {
    await this.tableStateStore.initialize();
    const persistedTables = await this.tableStateStore.loadTables();
    this.tables = new Map<string, TableState>(persistedTables.map((table) => [table.tableId, table]));

    for (const table of this.tables.values()) {
      this.ensureTableScoreEntries(table);
      this.ensureTurnConstraints(table);
      if (table.status === 'playing') {
        this.scheduleBotTurn(table.tableId);
      }
    }
  }

  handleConnection(client: Socket) {
    client.emit('connected', {
      clientId: client.id,
      serverTime: Date.now(),
    });
    client.emit('tables:update', this.getTableSummaries());
  }

  handleDisconnect(client: Socket) {
    const tableId = String(client.data['tableId'] ?? '');
    if (!tableId) {
      return;
    }

    this.broadcastTable(tableId);
    this.broadcastTables();
  }

  @SubscribeMessage('tables:list')
  onTablesList(@ConnectedSocket() client: Socket) {
    client.emit('tables:update', this.getTableSummaries());
    return { ok: true };
  }

  @SubscribeMessage('table:create')
  onCreateTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { tableId: string; ownerPlayerId: string; ownerDisplayName: string; targetPlayers?: number },
  ) {
    const tableId = body.tableId.trim();
    const ownerPlayerId = body.ownerPlayerId.trim();
    const ownerDisplayName = body.ownerDisplayName.trim();
    const targetPlayers = body.targetPlayers ?? this.maxPlayers;

    if (!tableId || !ownerPlayerId || !ownerDisplayName) {
      return { ok: false, error: 'tableId, ownerPlayerId and ownerDisplayName are required' };
    }

    if (targetPlayers < this.minPlayersToStart || targetPlayers > this.maxPlayers) {
      return { ok: false, error: `targetPlayers must be between ${this.minPlayersToStart} and ${this.maxPlayers}` };
    }

    if (this.tables.has(tableId)) {
      return { ok: false, error: 'Table already exists' };
    }

    const table: TableState = {
      tableId,
      status: 'waiting',
      ownerPlayerId,
      targetPlayers,
      players: [
        {
          playerId: ownerPlayerId,
          displayName: ownerDisplayName,
          seat: 0,
          isBot: false,
        },
      ],
      game: null,
      tableScores: { [ownerPlayerId]: 0 },
      completedHands: 0,
    };

    this.tables.set(tableId, table);
    client.data['tableId'] = tableId;
    client.data['playerId'] = ownerPlayerId;
    client.join(tableId);

    this.broadcastTable(tableId);
    this.broadcastTables();
    void this.persistTables();
    return { ok: true, tableId, playerId: ownerPlayerId };
  }

  @SubscribeMessage('table:join')
  onJoinTable(@ConnectedSocket() client: Socket, @MessageBody() body: { tableId: string; playerId: string; displayName: string }) {
    const tableId = body.tableId.trim();
    const playerId = body.playerId.trim();
    const displayName = body.displayName.trim();

    if (!tableId || !playerId || !displayName) {
      return { ok: false, error: 'tableId, playerId and displayName are required' };
    }

    const table = this.tables.get(tableId);
    if (!table) {
      return { ok: false, error: 'Table not found' };
    }

    const existing = table.players.find((entry) => entry.playerId === playerId);
    let joinedNewHuman = false;
    if (existing) {
      existing.displayName = displayName;
      existing.isBot = false;
    } else {
      if (table.status !== 'waiting') {
        return { ok: false, error: 'Game already started for this table' };
      }

      if (table.players.length >= this.maxPlayers) {
        return { ok: false, error: 'Table is full' };
      }

      const usedSeats = new Set(table.players.map((entry) => entry.seat));
      const nextSeat = [...Array(this.maxPlayers).keys()].find((seat) => !usedSeats.has(seat));
      if (nextSeat === undefined) {
        return { ok: false, error: 'No seat available' };
      }

      table.players.push({
        playerId,
        displayName,
        seat: nextSeat,
        isBot: false,
      });
      joinedNewHuman = true;
      table.players.sort((a, b) => a.seat - b.seat);

      if (table.tableScores[playerId] === undefined) {
        table.tableScores[playerId] = 0;
      }
    }

    client.data['tableId'] = tableId;
    client.data['playerId'] = playerId;
    client.join(tableId);

    if (joinedNewHuman) {
      this.server.to(tableId).emit('table:notice', {
        tableId,
        kind: 'player-joined',
        message: `${displayName} e entrato al tavolo`,
        playerId,
        displayName,
      });
    }

    this.broadcastTable(tableId);
    this.broadcastTables();
    void this.persistTables();
    return { ok: true, tableId, playerId };
  }

  @SubscribeMessage('table:add-bot')
  onAddBot(@MessageBody() body: { tableId: string }) {
    const table = this.tables.get(body.tableId);
    if (!table) {
      return { ok: false, error: 'Table not found' };
    }

    if (table.status !== 'waiting') {
      return { ok: false, error: 'Cannot add bot after game start' };
    }

    if (table.players.length >= this.maxPlayers) {
      return { ok: false, error: 'Table is full' };
    }

    const botIndex = table.players.filter((entry) => entry.isBot).length + 1;
    const botId = `bot-${botIndex}-${Math.random().toString(16).slice(2, 6)}`;

    const usedSeats = new Set(table.players.map((entry) => entry.seat));
    const nextSeat = [...Array(this.maxPlayers).keys()].find((seat) => !usedSeats.has(seat));
    if (nextSeat === undefined) {
      return { ok: false, error: 'No seat available' };
    }

    table.players.push({
      playerId: botId,
      displayName: `BOT ${botIndex}`,
      seat: nextSeat,
      isBot: true,
    });
    table.players.sort((a, b) => a.seat - b.seat);
    table.tableScores[botId] = table.tableScores[botId] ?? 0;

    this.broadcastTable(table.tableId);
    this.broadcastTables();
    void this.persistTables();
    return { ok: true };
  }

  @SubscribeMessage('table:start')
  onStartTable(@MessageBody() body: { tableId: string; playerId: string }) {
    const table = this.tables.get(body.tableId);
    if (!table) {
      return { ok: false, error: 'Table not found' };
    }

    if (table.ownerPlayerId !== body.playerId) {
      return { ok: false, error: 'Only table owner can start the game' };
    }

    if (table.players.length < this.minPlayersToStart || table.players.length > this.maxPlayers) {
      return { ok: false, error: `Need between ${this.minPlayersToStart} and ${this.maxPlayers} players to start` };
    }

    if (table.players.length !== table.targetPlayers) {
      return { ok: false, error: `Need exactly ${table.targetPlayers} players to start this table` };
    }

    this.ensureTableScoreEntries(table);

    const orderedPlayers = [...table.players]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({ playerId: player.playerId, isBot: player.isBot }));
    const starterIndex = table.completedHands % orderedPlayers.length;
    const starterPlayerId = orderedPlayers[starterIndex]?.playerId;
    const game = this.engine.createInitialState(table.tableId, orderedPlayers, {
      startingPlayerId: starterPlayerId,
    });
    table.game = game;
    table.status = 'playing';

    this.scheduleBotTurn(table.tableId);
    this.broadcastTable(table.tableId);
    this.broadcastTables();
    void this.persistTables();
    return { ok: true };
  }

  @SubscribeMessage('table:delete')
  onDeleteTable(@ConnectedSocket() client: Socket, @MessageBody() body: { tableId: string; playerId: string }) {
    const table = this.tables.get(body.tableId);
    if (!table) {
      return { ok: false, error: 'Table not found' };
    }

    if (table.ownerPlayerId !== body.playerId) {
      return { ok: false, error: 'Only table owner can delete the table' };
    }

    const timer = this.botTimers.get(body.tableId);
    if (timer) {
      clearTimeout(timer);
      this.botTimers.delete(body.tableId);
    }

    this.server.to(body.tableId).emit('table:deleted', {
      tableId: body.tableId,
      message: `Il tavolo ${body.tableId} e stato eliminato`,
    });
    this.server.in(body.tableId).socketsLeave(body.tableId);
    this.tables.delete(body.tableId);
    client.data['tableId'] = undefined;

    this.broadcastTables();
    void this.persistTables();
    return { ok: true };
  }

  @SubscribeMessage('table:state')
  onTableState(@ConnectedSocket() client: Socket, @MessageBody() body: { tableId: string }) {
    const table = this.tables.get(body.tableId);
    if (!table) {
      return { ok: false, error: 'Table not found' };
    }

    client.emit('table:update', table);
    return { ok: true };
  }

  @SubscribeMessage('table:command')
  onCommand(@ConnectedSocket() client: Socket, @MessageBody() body: { tableId: string; command: GameCommand }) {
    const table = this.tables.get(body.tableId);
    if (!table || !table.game) {
      return { ok: false, error: 'Table not found' };
    }

    const socketPlayerId = String(client.data['playerId'] ?? '');
    if (!socketPlayerId || socketPlayerId !== body.command.playerId) {
      return { ok: false, error: 'Command player mismatch for this session' };
    }

    const actingPlayer = table.players.find((entry) => entry.playerId === body.command.playerId);
    if (!actingPlayer || actingPlayer.isBot) {
      return { ok: false, error: 'Only joined human players can send commands' };
    }

    try {
      const previousState = table.game;
      const nextState = this.engine.applyCommand(table.game, body.command);
      table.game = nextState;
      this.recordFinishedHand(table, previousState, nextState);
      if (nextState.finished) {
        table.status = 'finished';
      } else {
        this.scheduleBotTurn(table.tableId);
      }

      this.broadcastTable(body.tableId);
      this.broadcastTables();
      void this.persistTables();
      return { ok: true };
    } catch (error) {
      client.emit('command:error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return { ok: false };
    }
  }

  private broadcastTable(tableId: string) {
    const table = this.tables.get(tableId);
    if (!table) {
      return;
    }

    this.server.to(tableId).emit('table:update', table);
  }

  private getTableSummaries(): TableSummary[] {
    const summaries: TableSummary[] = [];
    for (const table of this.tables.values()) {
      const owner = table.ownerPlayerId ? table.players.find((entry) => entry.playerId === table.ownerPlayerId) : undefined;
      const botsCount = table.players.filter((entry) => entry.isBot).length;
      summaries.push({
        tableId: table.tableId,
        status: table.status,
        ownerPlayerId: table.ownerPlayerId,
        ownerDisplayName: owner?.displayName ?? null,
        targetPlayers: table.targetPlayers,
        playersCount: table.players.length,
        humansCount: table.players.length - botsCount,
        botsCount,
        maxPlayers: this.maxPlayers,
      });
    }

    return summaries.sort((a, b) => a.tableId.localeCompare(b.tableId));
  }

  private broadcastTables() {
    this.server.emit('tables:update', this.getTableSummaries());
  }

  private scheduleBotTurn(tableId: string) {
    const existingTimer = this.botTimers.get(tableId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.botTimers.delete(tableId);
    }

    const table = this.tables.get(tableId);
    if (!table || !table.game || table.status !== 'playing') {
      return;
    }

    const active = table.game.players.find((player) => player.playerId === table.game?.turnPlayerId);
    if (!active || !active.isBot || table.game.finished) {
      return;
    }

    const timer = setTimeout(() => this.playOneBotTurn(tableId), 700);
    this.botTimers.set(tableId, timer);
  }

  private playOneBotTurn(tableId: string) {
    this.botTimers.delete(tableId);

    const table = this.tables.get(tableId);
    if (!table || !table.game || table.status !== 'playing') {
      return;
    }

    const active = table.game.players.find((player) => player.playerId === table.game?.turnPlayerId);
    if (!active || !active.isBot || table.game.finished) {
      return;
    }

    const previousState = table.game;
    table.game = this.engine.applyBotTurn(table.game);
    this.recordFinishedHand(table, previousState, table.game);
    if (table.game.finished) {
      table.status = 'finished';
    }

    this.broadcastTable(tableId);
    if (table.status === 'playing') {
      this.scheduleBotTurn(tableId);
    }
    void this.persistTables();
  }

  private ensureTableScoreEntries(table: TableState) {
    if (!table.tableScores) {
      table.tableScores = {};
    }

    for (const player of table.players) {
      if (table.tableScores[player.playerId] === undefined) {
        table.tableScores[player.playerId] = 0;
      }
    }

    if (!table.completedHands) {
      table.completedHands = 0;
    }

    if (!table.targetPlayers || table.targetPlayers < this.minPlayersToStart || table.targetPlayers > this.maxPlayers) {
      table.targetPlayers = this.maxPlayers;
    }
  }

  private recordFinishedHand(table: TableState, previousState: TableState['game'], nextState: TableState['game']) {
    if (!nextState || !nextState.finished || previousState?.finished) {
      return;
    }

    this.ensureTableScoreEntries(table);
    const partials = this.computeHandPartials(nextState.melds, nextState.players);
    for (const [playerId, partial] of Object.entries(partials)) {
      table.tableScores[playerId] = (table.tableScores[playerId] ?? 0) + partial;
    }
    table.completedHands += 1;
  }

  private ensureTurnConstraints(table: TableState) {
    if (!table.game) {
      return;
    }

    if (!Array.isArray(table.game.turnMustReuseWildcardCardIds)) {
      table.game.turnMustReuseWildcardCardIds = [];
    }

    if (table.game.turnMustReuseWildcardMeldId === undefined) {
      table.game.turnMustReuseWildcardMeldId = null;
    }
  }

  private async persistTables() {
    await this.tableStateStore.saveTables([...this.tables.values()]);
  }

  private computeHandPartials(melds: Meld[], players: Array<{ playerId: string; hand: GameCard[] }>) {
    const meldPointsByPlayer = new Map<string, number>();
    for (const meld of melds) {
      const current = meldPointsByPlayer.get(meld.ownerPlayerId) ?? 0;
      meldPointsByPlayer.set(meld.ownerPlayerId, current + this.meldValue(meld));
    }

    const partials: Record<string, number> = {};
    for (const player of players) {
      const meldPoints = meldPointsByPlayer.get(player.playerId) ?? 0;
      const handPoints = player.hand.reduce((total, card) => total + this.cardPoints(card), 0);
      partials[player.playerId] = meldPoints - handPoints;
    }

    return partials;
  }

  private meldValue(meld: Meld) {
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

  private cardPoints(card: GameCard) {
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

  private isPoker(meld: Meld) {
    return meld.type === 'set' && meld.cards.length === 4;
  }

  private completeRunScore(meld: Meld) {
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
}
