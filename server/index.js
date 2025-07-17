const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// In-memory game/session store
const games = {};

// AI word generation using OpenRouter Mistral 7B Instruct
async function getAIWords(topic = 'anything', count = 10) {
  const prompt = `I’m building a drawing-based guessing game like Pictionary.Do not include any explanations, numbers, or extra text\n\nPlease give me a list of 10 words for the topic: \"${topic}\".\n\nThese words should:\n- Be visually representable by drawing (no abstract ideas).\n- Be easy to guess by players (not too obscure).\n- Be appropriate for all age groups.\n\nReturn ONLY the list of words in plain text format, one word per line.`;
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'mistralai/mistral-7b-instruct',
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  const text = response.data.choices[0].message.content;
  return text.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
}

function emitGameUpdate(io, code, game) {
  io.to(code).emit('update', {
    code: game.code,
    players: game.players,
    teams: game.teams,
    started: game.started,
    time: game.time,
    scores: game.scores,
    currentWord: game.currentWord,
    topic: game.topic,
  });
}

app.get('/', (req, res) => {
  res.send('DrawBattle backend running');
});

// REST endpoint to create a new game (now with topic)
app.post('/api/create-game', async (req, res) => {
  const { topic = 'anything' } = req.body;
  const code = Math.random().toString(36).substr(2, 6).toUpperCase();
  const words = await getAIWords(topic, 10);
  games[code] = {
    code,
    players: [],
    teams: { A: [], B: [] },
    started: false,
    time: 5,
    drawer: {},
    scores: {},
    currentWord: '',
    topic,
    words,
  };
  res.json({ code });
});

// REST endpoint to join a game
app.post('/api/join-game', (req, res) => {
  const { code, name } = req.body;
  const game = games[code];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.players.find(p => p.name === name)) return res.status(400).json({ error: 'Name already taken' });
  const player = { name, team: 'A', isDrawer: false };
  game.players.push(player);
  game.teams.A.push(player);
  game.scores[name] = 0;
  res.json({ success: true });
});

async function getRandomWord(game) {
  if (!game.words || game.words.length < 2) {
    game.words = await getAIWords(game.topic, 10);
  }
  return game.words.pop();
}

async function startRound(game) {
  game.currentWord = await getRandomWord(game);
  game.drawingData = [];
  game.guessed = false;
}

function startTimer(io, code, game) {
  let time = game.time * 60;
  game.timer = setInterval(() => {
    time--;
    io.to(code).emit('timer', time);
    if (time <= 0) {
      clearInterval(game.timer);
      emitGameUpdate(io, code, game);
      io.to(code).emit('game-ended');
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('join-game', ({ code, name }) => {
    const game = games[code];
    if (!game) return;
    socket.join(code);
    socket.data = { code, name };
    emitGameUpdate(io, code, game);
  });

  socket.on('switch-team', () => {
    const { code, name } = socket.data;
    const game = games[code];
    if (!game) return;
    const player = game.players.find(p => p.name === name);
    if (!player) return;
    game.teams[player.team] = game.teams[player.team].filter(p => p.name !== name);
    player.team = player.team === 'A' ? 'B' : 'A';
    game.teams[player.team].push(player);
    emitGameUpdate(io, code, game);
  });

  socket.on('set-time', (time) => {
    const { code } = socket.data;
    const game = games[code];
    if (!game) return;
    game.time = time;
    emitGameUpdate(io, code, game);
  });

  socket.on('start-game', async () => {
    const { code } = socket.data;
    const game = games[code];
    if (!game) return;
    game.started = true;
    await startRound(game);
    emitGameUpdate(io, code, game);
    io.to(code).emit('game-started');
    startTimer(io, code, game);
  });

  socket.on('draw', ({ code, line }) => {
    const game = games[code];
    if (!game) return;
    if (!game.drawingData) game.drawingData = [];
    if (!Array.isArray(game.drawingData)) game.drawingData = [];
    const lineCopy = line.map(point => ({ ...point }));
    game.drawingData.push(lineCopy);
    io.to(code).emit('drawing', lineCopy);
  });

  socket.on('guess', async ({ code, name, guess }) => {
    const game = games[code];
    if (!game || !game.currentWord) return;
    if (game.guessed) return;
    if (guess.trim().toLowerCase() === game.currentWord.toLowerCase()) {
      game.scores[name] = (game.scores[name] || 0) + 10;
      game.guessed = true;
      io.to(code).emit('guess-feedback', 'Correct!');
      await startRound(game);
      emitGameUpdate(io, code, game);
      io.to(code).emit('drawing', []); // Clear the canvas for all clients
    } else {
      socket.emit('guess-feedback', 'Incorrect!');
    }
  });

  socket.on('disconnect', () => {
    const { code, name } = socket.data || {};
    if (!code || !name) return;
    const game = games[code];
    if (!game) return;
    game.players = game.players.filter(p => p.name !== name);
    game.teams.A = game.teams.A.filter(p => p.name !== name);
    game.teams.B = game.teams.B.filter(p => p.name !== name);
    delete game.scores[name];
    emitGameUpdate(io, code, game);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 