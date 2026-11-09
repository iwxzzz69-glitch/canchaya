import type { ReactNode } from 'react';

export const metadata = {
  title: 'CanchaYa',
  description: 'Reserva canchas deportivas y arma tu partido',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
