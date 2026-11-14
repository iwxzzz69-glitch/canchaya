import type { Metadata, Viewport } from 'next';
import '@fontsource/big-shoulders-display/latin-600';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource-variable/instrument-sans/index.css';
import './globals.css';
import { BottomNav, Header } from './_components/Nav';
import { SessionProvider } from './_lib/session';

export const metadata: Metadata = {
  title: { default: 'CanchaYa: reserva tu cancha y arma tu partido', template: '%s · CanchaYa' },
  description: 'Reserva canchas de fútbol, vóley, pádel y básquet en Lima, y encuentra jugadores para completar tu equipo.',
};
export const viewport: Viewport = { themeColor: '#0C1814', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <SessionProvider>
          <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-lamp focus:px-4 focus:py-2 focus:text-lamp-ink">Saltar al contenido</a>
          <Header />
          <main id="contenido" className="mx-auto max-w-6xl px-4 pb-28 pt-8 md:pb-16">{children}</main>
          <BottomNav />
        </SessionProvider>
      </body>
    </html>
  );
}
