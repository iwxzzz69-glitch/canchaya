// numeric de PostgreSQL llega como string; lo convertimos a number al leer.
export const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? value : Number(value)),
};
