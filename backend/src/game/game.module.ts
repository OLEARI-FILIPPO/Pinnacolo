import { Module } from '@nestjs/common';
import { GameEngineService } from './engine/game-engine.service';
import { TableStateStoreService } from './persistence/table-state-store.service';
import { GameGateway } from './ws/game.gateway';

@Module({
  providers: [GameEngineService, TableStateStoreService, GameGateway],
  exports: [GameEngineService],
})
export class GameModule {}
