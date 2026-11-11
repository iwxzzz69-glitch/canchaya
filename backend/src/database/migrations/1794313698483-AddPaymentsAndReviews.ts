import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentsAndReviews1794313698483 implements MigrationInterface {
    name = 'AddPaymentsAndReviews1794313698483'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('processing', 'succeeded', 'failed', 'refund_pending', 'refunded', 'refund_failed')`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "booking_id" uuid NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'PEN', "provider" character varying(20) NOT NULL, "provider_charge_id" character varying, "status" "public"."payments_status_enum" NOT NULL DEFAULT 'processing', "failure_code" character varying, "failure_message" character varying, "refund_id" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_756f372f43e1e0e08960fc76f3" ON "payments" ("provider_charge_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "payments_one_active_per_booking" ON "payments" ("booking_id") WHERE "status" IN ('processing', 'succeeded')`);
        await queryRunner.query(`CREATE TABLE "reviews" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "booking_id" uuid NOT NULL, "venue_id" uuid NOT NULL, "player_id" uuid NOT NULL, "rating" smallint NOT NULL, "comment" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5), CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bbd6ac6e3e6a8f8c6e0e8692d6" ON "reviews" ("booking_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_892f659696877d5b0a4a37de09" ON "reviews" ("venue_id") `);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_e86edf76dc2424f123b9023a2b2" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_bbd6ac6e3e6a8f8c6e0e8692d63" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_892f659696877d5b0a4a37de098" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_956680ba5490b04f7cc38846138" FOREIGN KEY ("player_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_956680ba5490b04f7cc38846138"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_892f659696877d5b0a4a37de098"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_bbd6ac6e3e6a8f8c6e0e8692d63"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_e86edf76dc2424f123b9023a2b2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_892f659696877d5b0a4a37de09"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bbd6ac6e3e6a8f8c6e0e8692d6"`);
        await queryRunner.query(`DROP TABLE "reviews"`);
        await queryRunner.query(`DROP INDEX "public"."payments_one_active_per_booking"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_756f372f43e1e0e08960fc76f3"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
    }

}
