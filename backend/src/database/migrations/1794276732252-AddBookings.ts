import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBookings1794276732252 implements MigrationInterface {
    name = 'AddBookings1794276732252'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Necesaria para la restricción de exclusión (mezcla igualdad de uuid con solapamiento de rangos).
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
        await queryRunner.query(`CREATE TYPE "public"."bookings_status_enum" AS ENUM('pending', 'confirmed', 'cancelled', 'expired')`);
        await queryRunner.query(`CREATE TABLE "bookings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "court_id" uuid NOT NULL, "player_id" uuid NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."bookings_status_enum" NOT NULL DEFAULT 'pending', "total_price" numeric(10,2) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "bookings_ends_after_start" CHECK ("ends_at" > "starts_at"), CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("court_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" IN ('pending', 'confirmed')), CONSTRAINT "PK_bee6805982cc1e248e94ce94957" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2bd7e9c03db9f51a4765974abb" ON "bookings" ("court_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_129e7fe11e40d931c7bfdcf7e0" ON "bookings" ("player_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_0a69ec1e2efabbeb2977fbcc48" ON "bookings" ("status", "expires_at") `);
        await queryRunner.query(`ALTER TABLE "courts" ADD "open_hour" smallint NOT NULL DEFAULT '8'`);
        await queryRunner.query(`ALTER TABLE "courts" ADD "close_hour" smallint NOT NULL DEFAULT '23'`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "FK_2bd7e9c03db9f51a4765974abb8" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "FK_129e7fe11e40d931c7bfdcf7e04" FOREIGN KEY ("player_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "FK_129e7fe11e40d931c7bfdcf7e04"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "FK_2bd7e9c03db9f51a4765974abb8"`);
        await queryRunner.query(`ALTER TABLE "courts" DROP COLUMN "close_hour"`);
        await queryRunner.query(`ALTER TABLE "courts" DROP COLUMN "open_hour"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a69ec1e2efabbeb2977fbcc48"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_129e7fe11e40d931c7bfdcf7e0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2bd7e9c03db9f51a4765974abb"`);
        await queryRunner.query(`DROP TABLE "bookings"`);
        await queryRunner.query(`DROP TYPE "public"."bookings_status_enum"`);
    }

}
