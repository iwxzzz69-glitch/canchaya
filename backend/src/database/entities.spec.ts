import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ALL_ENTITIES } from './entities';

// Cada clase marcada con @Entity() debe estar en ALL_ENTITIES: de ahí leen la aplicación, las
// migraciones y los tests. Si agregas una entidad y la olvidas, este test falla.
function entityFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : entityFiles(path);
    return name.endsWith('.entity.ts') ? [path] : [];
  });
}

describe('registro de entidades', () => {
  const files = entityFiles(join(__dirname, '..'));
  // Convención: una entidad por archivo *.entity.ts, y es su primera clase exportada.
  const declared = files.map((file) => /export class (\w+)/.exec(readFileSync(file, 'utf8'))?.[1]);

  it('encuentra el nombre de la clase de cada archivo *.entity.ts', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(declared.every(Boolean)).toBe(true);
    for (const file of files) expect(readFileSync(file, 'utf8')).toContain('@Entity(');
  });

  it('todas las entidades declaradas están en ALL_ENTITIES', () => {
    const registered = ALL_ENTITIES.map((e) => e.name);
    expect(declared.filter((name) => !registered.includes(name as string))).toEqual([]);
  });

  it('ALL_ENTITIES coincide exactamente con las declaradas (ni de más ni de menos)', () => {
    expect(ALL_ENTITIES.map((e) => e.name).sort()).toEqual([...declared].sort());
  });
});
