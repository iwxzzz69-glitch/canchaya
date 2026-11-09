export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>CanchaYa ⚽</h1>
      <p>Reserva tu cancha y arma tu partido.</p>
      <ul>
        <li>API: {process.env.NEXT_PUBLIC_API_URL}</li>
        <li>Chat: {process.env.NEXT_PUBLIC_CHAT_URL}</li>
      </ul>
    </main>
  );
}
