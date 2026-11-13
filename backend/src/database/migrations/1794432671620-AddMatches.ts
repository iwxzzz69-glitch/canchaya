import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMatches1794432671620 implements MigrationInterface {
    name = 'AddMatches1794432671620'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."matches_level_enum" AS ENUM('casual', 'intermediate', 'advanced')`);
        await queryRunner.query(`CREATE TYPE "public"."matches_status_enum" AS ENUM('open', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "matches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "booking_id" uuid NOT NULL, "organizer_id" uuid NOT NULL, "spots_total" smallint NOT NULL, "spots_taken" smallint NOT NULL DEFAULT '0', "level" "public"."matches_level_enum" NOT NULL DEFAULT 'casual', "notes" character varying(300), "status" "public"."matches_status_enum" NOT NULL DEFAULT 'open', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_afd6031f8b80aba1157095e49b" UNIQUE ("booking_id"), CONSTRAINT "matches_spots_taken_in_range" CHECK ("spots_taken" >= 0 AND "spots_taken" <= "spots_total"), CONSTRAINT "matches_spots_in_range" CHECK ("spots_total" BETWEEN 1 AND 20), CONSTRAINT "PK_8a22c7b2e0828988d51256117f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e21a652c5b49de581dbf3f205f" ON "matches" ("organizer_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_a182c2c9602fbab4e0cf680090" ON "matches" ("status") `);
        await queryRunner.query(`CREATE TABLE "match_players" ("match_id" uuid NOT NULL, "player_id" uuid NOT NULL, "joined_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_eb715a7445fe45c0da71d2a2e37" PRIMARY KEY ("match_id", "player_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4976f49b9d06b2c073cf438992" ON "match_players" ("player_id") `);
        await queryRunner.query(`ALTER TABLE "matches" ADD CONSTRAINT "FK_afd6031f8b80aba1157095e49b9" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "matches" ADD CONSTRAINT "FK_e21a652c5b49de581dbf3f205fb" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "match_players" ADD CONSTRAINT "FK_065584e9a7b86a9ad63180af39e" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "match_players" ADD CONSTRAINT "FK_4976f49b9d06b2c073cf438992d" FOREIGN KEY ("player_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "match_players" DROP CONSTRAINT "FK_4976f49b9d06b2c073cf438992d"`);
        await queryRunner.query(`ALTER TABLE "match_players" DROP CONSTRAINT "FK_065584e9a7b86a9ad63180af39e"`);
        await queryRunner.query(`ALTER TABLE "matches" DROP CONSTRAINT "FK_e21a652c5b49de581dbf3f205fb"`);
        await queryRunner.query(`ALTER TABLE "matches" DROP CONSTRAINT "FK_afd6031f8b80aba1157095e49b9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4976f49b9d06b2c073cf438992"`);
        await queryRunner.query(`DROP TABLE "match_players"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a182c2c9602fbab4e0cf680090"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e21a652c5b49de581dbf3f205f"`);
        await queryRunner.query(`DROP TABLE "matches"`);
        await queryRunner.query(`DROP TYPE "public"."matches_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."matches_level_enum"`);
    }

}
