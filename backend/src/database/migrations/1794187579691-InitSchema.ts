import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1794187579691 implements MigrationInterface {
    name = 'InitSchema1794187579691'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."courts_sport_enum" AS ENUM('football', 'volleyball', 'padel', 'basketball')`);
        await queryRunner.query(`CREATE TABLE "courts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "venue_id" uuid NOT NULL, "name" character varying NOT NULL, "sport" "public"."courts_sport_enum" NOT NULL, "price_per_hour" numeric(10,2) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_948a5d356c3083f3237ecbf9897" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9da2e37c269dfe8cbbfd8d8758" ON "courts" ("venue_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d389f4a22d140b1954e69ff73e" ON "courts" ("sport") `);
        await queryRunner.query(`CREATE TABLE "venues" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_id" uuid NOT NULL, "name" character varying NOT NULL, "description" text, "address" character varying NOT NULL, "zone" character varying NOT NULL, "latitude" double precision, "longitude" double precision, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cb0f885278d12384eb7a81818be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8cb5cf3df16fc75663f85b5b35" ON "venues" ("owner_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_24c9afef82382d54244fe824be" ON "venues" ("zone") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('player', 'owner', 'admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "name" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'player', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "courts" ADD CONSTRAINT "FK_9da2e37c269dfe8cbbfd8d87583" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "venues" ADD CONSTRAINT "FK_8cb5cf3df16fc75663f85b5b35c" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "venues" DROP CONSTRAINT "FK_8cb5cf3df16fc75663f85b5b35c"`);
        await queryRunner.query(`ALTER TABLE "courts" DROP CONSTRAINT "FK_9da2e37c269dfe8cbbfd8d87583"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_24c9afef82382d54244fe824be"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8cb5cf3df16fc75663f85b5b35"`);
        await queryRunner.query(`DROP TABLE "venues"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d389f4a22d140b1954e69ff73e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9da2e37c269dfe8cbbfd8d8758"`);
        await queryRunner.query(`DROP TABLE "courts"`);
        await queryRunner.query(`DROP TYPE "public"."courts_sport_enum"`);
    }

}
