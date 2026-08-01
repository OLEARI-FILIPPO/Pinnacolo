import { Module } from '@nestjs/common';
import { GameEngineService } from './engine/game-engine.service';
import { GameGateway } from './ws/game.gateway';

@Module({
  providers: [GameEngineService, GameGateway],
  exports: [GameEngineService],
})
export class GameModule {}
