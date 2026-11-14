import type { Config } from 'tailwindcss';

// Paleta "cancha de noche": césped oscuro, líneas de tiza y un solo acento ámbar de reflector.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0C1814', // fondo
        pitch: { DEFAULT: '#13241E', raised: '#1B3229' }, // superficies
        chalk: '#E9F0E2', // texto y líneas
        mute: '#93A89C', // texto secundario
        lamp: { DEFAULT: '#FFB938', ink: '#2A1C00' }, // acento: lo que se puede reservar o hacer
        free: '#5BD18B', // horario libre
        alert: '#FF7466',
      },
      fontFamily: {
        display: ['"Big Shoulders Display"', 'Impact', 'sans-serif'],
        sans: ['"Instrument Sans Variable"', 'system-ui', 'sans-serif'],
      },
      borderColor: { DEFAULT: 'rgba(233,240,226,0.18)' },
    },
  },
  plugins: [],
};
export default config;
