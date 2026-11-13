import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Match } from './match.entity';

// La clave primaria compuesta impide que una misma persona se una dos veces al mismo partido.
@Entity('match_players')
export class MatchPlayer {
  @PrimaryColumn({ name: 'match_id' })
  matchId!: string;

  @ManyToOne(() => Match, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'match_id' })
  match!: Match;

  @Index()
  @PrimaryColumn({ name: 'player_id' })
  playerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'player_id' })
  player!: User;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt!: Date;
}
