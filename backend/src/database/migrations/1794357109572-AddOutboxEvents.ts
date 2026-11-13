import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOutboxEvents1794357109572 implements MigrationInterface {
    name = 'AddOutboxEvents1794357109572'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "last_error" text, CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "outbox_events_pending" ON "outbox_events" ("created_at", "id") WHERE "published_at" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."outbox_events_pending"`);
        await queryRunner.query(`DROP TABLE "outbox_events"`);
    }

}
