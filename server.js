const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;

const responses = {}; // { lobbyName: { playerName: { "1": "A", ... } } }
const lobbies = {};   // { lobbyName: { gmId: socket.id, players: [], currentQuestion: int } }

app.use(express.static(path.join(__dirname, 'public')));
app.use('/exports', express.static(path.join(__dirname, 'exports')));

// S'assurer que le dossier exports existe
const exportPath = path.join(__dirname, 'exports');
if (!fs.existsSync(exportPath)) fs.mkdirSync(exportPath);

function getQuestion(index) {
  const filePath = path.join(__dirname, 'public', `question${index}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

io.on('connection', (socket) => {
  console.log("✅ Nouveau socket connecté :", socket.id);

  socket.on('create-lobby', (lobbyName) => {
    socket.lobby = lobbyName;
    lobbies[lobbyName] = { gmId: socket.id, players: [], currentQuestion: 0 };
    responses[lobbyName] = {};
    socket.emit('lobby-created', lobbyName);
    console.log("🎲 Lobby créé :", lobbyName);
  });

  socket.on('join-lobby', ({ playerName, lobbyName }) => {
    console.log(`👤 ${playerName} rejoint le lobby ${lobbyName}`);
    socket.lobby = lobbyName;
    socket.playerName = playerName;
    socket.join(lobbyName);

    if (!lobbies[lobbyName]) {
      console.warn(`⚠️ Lobby ${lobbyName} introuvable`);
      return;
    }

    if (!responses[lobbyName][playerName]) {
      responses[lobbyName][playerName] = {};
    }

    if (!lobbies[lobbyName].players.includes(playerName)) {
      lobbies[lobbyName].players.push(playerName);
    }

    io.to(lobbies[lobbyName].gmId).emit('player-joined', playerName);
    socket.emit('joined-lobby');
  });

  socket.on('rejoin-lobby', ({ lobbyName, playerName }) => {
    socket.lobby = lobbyName;
    socket.playerName = playerName;
    socket.join(lobbyName);
    console.log(`🔁 ${playerName} reconnecté dans ${lobbyName}`);
  });

  socket.on('start-game', () => {
    const lobby = socket.lobby;
    if (lobbies[lobby]) {
      io.in(lobby).emit('game-start');
      console.log("🚀 Démarrage de la partie dans :", lobby);
    }
  });

  socket.on('broadcast-next-question', () => {
    const lobby = lobbies[socket.lobby];
    lobby.currentQuestion++;
    const question = getQuestion(lobby.currentQuestion);

    if (question) {
      io.in(socket.lobby).emit('question', question);
      console.log(`📨 Envoi question ${lobby.currentQuestion} dans ${socket.lobby}`);
    } else {
      io.in(socket.lobby).emit('game-over');
      console.log(`🏁 Fin de la partie dans ${socket.lobby}`);
    }
  });

  socket.on('player-answer', ({ lobbyName, playerName, questionIndex, answer }) => {
    if (!responses[lobbyName][playerName]) {
      responses[lobbyName][playerName] = {};
    }

    // Empêche de voter deux fois
    if (responses[lobbyName][playerName][questionIndex]) return;

    responses[lobbyName][playerName][questionIndex] = answer;

    const question = getQuestion(questionIndex);
    const answerText = question.choices[answer.charCodeAt(0) - 65];

    // Feedback MJ
    io.to(lobbies[lobbyName].gmId).emit('player-answer', {
      playerName,
      answer,
      answerText,
      questionText: question.question,
      index: questionIndex
    });

    // Jauge anonyme
    const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
    for (const p in responses[lobbyName]) {
      const a = responses[lobbyName][p][questionIndex];
      if (a && voteCounts[a] !== undefined) voteCounts[a]++;
    }

    io.in(lobbyName).emit('vote-stats', voteCounts);
  });

  socket.on('request-csv', () => {
    const lobbyName = socket.lobby;
    const filename = `${lobbyName}_results.csv`;
    const filepath = path.join(__dirname, 'exports', filename);
    const questionIndexes = ['1', '2', '3', '4'];
    const header = ['Prénom', ...questionIndexes.map(q => `Question ${q}`)];
    const rows = [header];
    for (const player in responses[lobbyName]) {
      const row = [player, ...questionIndexes.map(q => responses[lobbyName][player][q] || '')];
      rows.push(row);
    }
    fs.writeFileSync(filepath, rows.map(r => r.join(',')).join('\n'), 'utf-8');
    socket.emit('csv-ready', filename);
    console.log("📁 CSV généré :", filename);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
