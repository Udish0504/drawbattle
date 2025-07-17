const API_URL = 'http://localhost:3001/api';

export async function createGame() {
  const res = await fetch(`${API_URL}/create-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}

export async function joinGame(code, name) {
  const res = await fetch(`${API_URL}/join-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  return res.json();
} 