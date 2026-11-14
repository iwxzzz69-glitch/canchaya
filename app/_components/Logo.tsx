// Marca: círculo central con la línea de mitad de cancha. Hereda el color del texto.
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="currentColor" strokeWidth="2" />
      <line x1="16" y1="1.5" x2="16" y2="30.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-lamp">
      <LogoMark />
      <span className="font-display text-[1.65rem] font-extrabold leading-none tracking-wide text-chalk">CanchaYa</span>
    </span>
  );
}
