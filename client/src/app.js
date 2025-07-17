// DrawBattle Clone - Plain JS Version
// This file manages all UI and game logic using vanilla JS

// Helper to switch screens
function showScreen(html) {
  document.getElementById('app').innerHTML = html;
}

// State
let gameCode = '';
let playerName = '';
let socket = null;
let game = null;
let timer = 0;
let scores = {};
let isDrawer = false;
let word = '';
let drawingData = [];
let gameEnded = false;
let latestFeedback = '';
let gameTopic = '';

// --- Home Screen ---
function renderHome() {
  showScreen(`
    <div class="home">
      <h2>DrawBattle Clone</h2>
      <input id="topicInput" placeholder="Enter topic (optional)" />
      <button id="newGameBtn">New Game</button>
      <div>
        <input id="codeInput" placeholder="Enter game code" />
        <button id="joinGameBtn">Join Game</button>
      </div>
      <div id="homeError" style="color:red;"></div>
    </div>
  `);
  document.getElementById('newGameBtn').onclick = async () => {
    const topic = document.getElementById('topicInput').value.trim();
    gameTopic = topic;
    const res = await fetch('http://localhost:3001/api/create-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    const data = await res.json();
    gameCode = data.code;
    renderEnterName();
  };
  document.getElementById('joinGameBtn').onclick = () => {
    const code = document.getElementById('codeInput').value.trim().toUpperCase();
    if (!code) {
      document.getElementById('homeError').textContent = 'Enter a code';
      return;
    }
    gameCode = code;
    renderEnterName();
  };
}

// --- Enter Name Screen ---
function renderEnterName() {
  showScreen(`
    <div class="enter-name">
      <h2>Enter Your Name</h2>
      <input id="nameInput" placeholder="Name" />
      <button id="startBtn">Start</button>
      <div id="nameError" style="color:red;"></div>
    </div>
  `);
  document.getElementById('startBtn').onclick = async () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) {
      document.getElementById('nameError').textContent = 'Enter your name';
      return;
    }
    const res = await fetch('http://localhost:3001/api/join-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: gameCode, name })
    });
    const data = await res.json();
    console.log('POST /api/join-game response:', data);
    if (data.error) {
      document.getElementById('nameError').textContent = data.error;
      return;
    }
    playerName = name;
    connectSocket();
  };
}

// --- Lobby Screen ---
function renderLobby() {
  showScreen(`
    <div class="lobby">
      <h2>Lobby / Teams (Code: ${gameCode})</h2>
      <div><b>Topic:</b> <span id="topicDisplay"></span></div>
      <div id="teams"></div>
      <button id="switchTeamBtn">Switch Team</button>
      <div>
        <label>Game Time: <input id="timeInput" type="number" min="1" max="60" value="5" /> minutes</label>
      </div>
      <button id="startGameBtn">Start Game</button>
      <div id="lobbyStatus"></div>
    </div>
  `);
  // connectSocket(); // Remove this line
  document.getElementById('topicDisplay').textContent = gameTopic || (game && game.topic) || 'Anything';
  document.getElementById('switchTeamBtn').onclick = () => socket.emit('switch-team');
  document.getElementById('timeInput').onchange = e => socket.emit('set-time', Number(e.target.value));
  document.getElementById('startGameBtn').onclick = () => socket.emit('start-game');
}

// --- Game Screen ---
function renderGame() {
  if (gameEnded) {
    showScreen(`<div style="text-align:center"><h2>Game Over!</h2><div>Final Scores:</div>${Object.entries(scores).map(([n, s]) => `<div>${n}: ${s}</div>`).join('')}</div>`);
    return;
  }
  showScreen(`
    <div class="game">
      <h2>Game Screen</h2>
      <div><b>Topic:</b> <span id="topicDisplay"></span></div>
      <div>Timer: <span id="timerDisplay"></span> | Score: <span id="scoreDisplay"></span></div>
      <canvas id="gameCanvas" width="400" height="300" style="border:1px solid #ccc; display:block; margin:20px auto;"></canvas>
      <div id="guessSection"></div>
      <div id="feedback" style="text-align:center;"></div>
      <div id="wordDisplay" style="text-align:center;"></div>
    </div>
  `);
  document.getElementById('topicDisplay').textContent = gameTopic || (game && game.topic) || 'Anything';
  document.getElementById('scoreDisplay').textContent = scores[playerName] || 0;
  document.getElementById('timerDisplay').textContent = formatTime(timer);
  if (!isDrawer) {
    document.getElementById('guessSection').innerHTML = `
      <form id="guessForm" style="text-align:center">
        <input id="guessInput" placeholder="Guess the word" />
        <button type="submit">Guess</button>
      </form>
    `;
    document.getElementById('guessForm').onsubmit = e => {
      e.preventDefault();
      const guess = document.getElementById('guessInput').value.trim();
      socket.emit('guess', { code: gameCode, name: playerName, guess });
      document.getElementById('guessInput').value = '';
    };
  } else {
    document.getElementById('wordDisplay').innerHTML = `Your word: <b>${word}</b>`;
  }
  setupCanvas();
  updateFeedback(); // Always update feedback after rendering
}

// --- Canvas Drawing Logic ---
function setupCanvas() {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let currentLine = [];
  if (isDrawer) {
    canvas.onmousedown = e => {
      drawing = true;
      currentLine = [getCanvasPos(e, canvas)];
    };
    canvas.onmousemove = e => {
      if (!drawing) return;
      currentLine.push(getCanvasPos(e, canvas));
      // Draw the current line as you go for the drawer
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawingData.forEach(line => drawLine(ctx, line));
      drawLine(ctx, currentLine);
    };
    canvas.onmouseup = () => {
      drawing = false;
      if (currentLine.length > 1) {
        socket.emit('draw', { code: gameCode, line: currentLine });
      }
      currentLine = [];
    };
    canvas.onmouseleave = () => { drawing = false; };
  } else {
    canvas.onmousedown = null;
    canvas.onmousemove = null;
    canvas.onmouseup = null;
    canvas.onmouseleave = null;
  }
  // Draw all lines
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawingData.forEach(line => drawLine(ctx, line));
}

function drawLine(ctx, line) {
  if (line.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(line[0].x, line[0].y);
  for (let i = 1; i < line.length; i++) {
    ctx.lineTo(line[i].x, line[i].y);
  }
  ctx.stroke();
}
function getCanvasPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// --- Socket.IO Integration ---
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io('http://localhost:3001');
  socket.emit('join-game', { code: gameCode, name: playerName });
  let firstUpdate = true;
  socket.on('update', g => {
    console.log('Received update event', g);
    game = g;
    scores = g.scores;
    if (g.topic) gameTopic = g.topic;
    if (firstUpdate) {
      renderLobby();
      firstUpdate = false;
    }
    renderTeams();
  });
  socket.on('game-started', () => renderGame());
  socket.on('timer', t => { timer = t; updateTimer(); });
  socket.on('drawing', line => {
    console.log('Received drawing line:', line);
    if (line.length === 0) {
      drawingData = [];
    } else {
      drawingData.push(line);
    }
    if (document.getElementById('gameCanvas')) setupCanvas();
  });
  socket.on('guess-feedback', msg => {
    console.log('Received guess feedback:', msg);
    latestFeedback = msg;
    updateFeedback();
  });
  socket.on('update', g => {
    // Update drawer/word
    const me = g.players.find(p => p.name === playerName);
    isDrawer = me && g.teams[me.team][0] && g.teams[me.team][0].name === playerName;
    word = isDrawer ? g.currentWord : '';
    if (document.getElementById('gameCanvas')) renderGame();
  });
  socket.on('drawing', line => {
    drawingData = line.length === 0 ? [] : [...drawingData, line];
    if (document.getElementById('gameCanvas')) setupCanvas();
  });
  socket.on('game-ended', () => { gameEnded = true; renderGame(); });
}

function renderTeams() {
  if (!game) return;
  const teamsDiv = document.getElementById('teams');
  if (!teamsDiv) return;
  teamsDiv.innerHTML = `
    <div style="display:flex;gap:40px">
      <div><h3>Team A</h3>${game.teams.A.map(p => `<div>${p.name}</div>`).join('')}</div>
      <div><h3>Team B</h3>${game.teams.B.map(p => `<div>${p.name}</div>`).join('')}</div>
    </div>
  `;
}

function updateTimer() {
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = formatTime(timer);
}
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateFeedback() {
  const el = document.getElementById('feedback');
  if (el && latestFeedback) {
    el.textContent = latestFeedback;
    el.style.color = latestFeedback === 'Correct!' ? 'green' : 'red';
  }
}

// --- Start the app ---
renderHome(); 