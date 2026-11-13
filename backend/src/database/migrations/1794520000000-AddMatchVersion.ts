import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMatchVersion1794520000000 implements MigrationInterface {
    name = 'AddMatchVersion1794520000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "matches" ADD "version" integer NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "version"`);
    }
}
