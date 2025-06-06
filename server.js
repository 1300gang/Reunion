const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const responses = {};
const lobbies = {};
const fileAccess = {}; // Tracker l'accès aux fichiers

// === CONFIGURATION SÉCURISÉE ===

// Headers de sécurité
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://api.qrserver.com", "data:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting - Protection contre le spam
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requêtes par IP
  message: 'Trop de requêtes, réessayez plus tard',
  standardHeaders: true,
  legacyHeaders: false
});

const socketLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // max 20 connexions socket par minute
  skipSuccessfulRequests: true
});

app.use(limiter);
app.use('/socket.io/', socketLimiter);

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// === FONCTIONS DE VALIDATION ET SÉCURITÉ ===

function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return '';
  return validator.escape(input.trim()).substring(0, 50);
}

function isValidLobbyName(name) {
  return /^[a-zA-Z0-9\s\-_]{1,30}$/.test(name);
}

function isValidPlayerName(name) {
  return /^[a-zA-Z0-9\s\-_]{1,20}$/.test(name);
}

function generateSecureFilename(lobbyName) {
  const hash = crypto.randomBytes(16).toString('hex');
  const sanitizedLobby = lobbyName.replace(/[^a-zA-Z0-9]/g, '_');
  return `results_${sanitizedLobby}_${hash}.csv`;
}

function isValidQuestionId(questionId) {
  return /^question[0-9A-Za-z]{1,10}$/.test(questionId);
}

function getQuestion(questionId) {
  // Validation stricte de l'ID de question
  if (!isValidQuestionId(questionId)) {
    console.warn(`Tentative d'accès à une question invalide: ${questionId}`);
    return null;
  }
  
  const filePath = path.join(__dirname, 'public', `${questionId}.json`);
  
  // Vérifier que le fichier est dans le bon répertoire (path traversal protection)
  const resolvedPath = path.resolve(filePath);
  const publicDir = path.resolve(path.join(__dirname, 'public'));
  
  if (!resolvedPath.startsWith(publicDir)) {
    console.warn(`Tentative de path traversal: ${questionId}`);
    return null;
  }
  
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Erreur lecture question ${questionId}:`, error);
      return null;
    }
  }
  return null;
}

// Protection des fichiers exports avec contrôle d'accès
app.get('/exports/:filename', (req, res) => {
  const filename = req.params.filename;
  
  // Validation du nom de fichier
  if (!/^results_[a-zA-Z0-9_]+\.csv$/.test(filename)) {
    return res.status(400).send('Nom de fichier invalide');
  }
  
  const filePath = path.join(__dirname, 'exports', filename);
  
  // Vérifier path traversal
  const resolvedPath = path.resolve(filePath);
  const exportsDir = path.resolve(path.join(__dirname, 'exports'));
  
  if (!resolvedPath.startsWith(exportsDir)) {
    return res.status(403).send('Accès interdit');
  }
  
  // Vérifier que le fichier existe
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Fichier non trouvé');
  }
  
  // Vérifier les permissions d'accès (optionnel: implémenter un système de tokens)
  if (!fileAccess[filename]) {
    return res.status(403).send('Accès non autorisé');
  }
  
  // Headers de sécurité pour le téléchargement
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Erreur envoi fichier:', err);
      res.status(500).send('Erreur serveur');
    } else {
      // Optionnel: supprimer le fichier après téléchargement
      setTimeout(() => {
        try {
          fs.unlinkSync(filePath);
          delete fileAccess[filename];
        } catch (e) {
          console.error('Erreur suppression fichier:', e);
        }
      }, 60000); // Supprimer après 1 minute
    }
  });
});

// === GESTION DES CONNEXIONS SOCKET ===

io.on('connection', (socket) => {
  console.log(`Nouvelle connexion: ${socket.id} depuis ${socket.handshake.address}`);
  
  // Limiter le nombre de lobbies par IP (protection DoS)
  const clientIP = socket.handshake.address;
  const userLobbies = Object.values(lobbies).filter(lobby => 
    lobby.creatorIP === clientIP
  ).length;
  
  socket.on('create-lobby', (lobbyName) => {
    // Validation
    const sanitizedLobbyName = sanitizeInput(lobbyName);
    
    if (!isValidLobbyName(sanitizedLobbyName)) {
      socket.emit('error', 'Nom de lobby invalide. Utilisez uniquement des lettres, chiffres, espaces, tirets et underscores.');
      return;
    }
    
    if (userLobbies >= 3) {
      socket.emit('error', 'Limite de lobbies par utilisateur atteinte');
      return;
    }
    
    if (lobbies[sanitizedLobbyName]) {
      socket.emit('error', 'Ce nom de lobby existe déjà');
      return;
    }
    
    socket.lobby = sanitizedLobbyName;
    lobbies[sanitizedLobbyName] = { 
      gmId: socket.id,
      creatorIP: clientIP,
      players: [], 
      currentQuestion: null,
      questionPath: [],
      gameStarted: false,
      createdAt: Date.now()
    };
    responses[sanitizedLobbyName] = {};
    
    socket.emit('lobby-created', sanitizedLobbyName);
    console.log(`Lobby créé: ${sanitizedLobbyName} par ${socket.id}`);
  });

  socket.on('join-lobby', ({ playerName, lobbyName }) => {
    // Validation
    const sanitizedPlayerName = sanitizeInput(playerName);
    const sanitizedLobbyName = sanitizeInput(lobbyName);
    
    if (!isValidPlayerName(sanitizedPlayerName)) {
      socket.emit('error', 'Nom de joueur invalide');
      return;
    }
    
    if (!isValidLobbyName(sanitizedLobbyName)) {
      socket.emit('error', 'Nom de lobby invalide');
      return;
    }
    
    if (!lobbies[sanitizedLobbyName]) {
      socket.emit('error', 'Lobby introuvable');
      return;
    }
    
    // Limiter le nombre de joueurs
    if (lobbies[sanitizedLobbyName].players.length >= 50) {
      socket.emit('error', 'Lobby plein');
      return;
    }
    
    // Vérifier que le nom n'est pas déjà pris
    if (lobbies[sanitizedLobbyName].players.includes(sanitizedPlayerName)) {
      socket.emit('error', 'Ce nom est déjà pris dans ce lobby');
      return;
    }
    
    socket.lobby = sanitizedLobbyName;
    socket.playerName = sanitizedPlayerName;
    socket.join(sanitizedLobbyName);
    
    lobbies[sanitizedLobbyName].players.push(sanitizedPlayerName);
    
    if (!responses[sanitizedLobbyName][sanitizedPlayerName]) {
      responses[sanitizedLobbyName][sanitizedPlayerName] = {};
    }
    
    io.to(lobbies[sanitizedLobbyName].gmId).emit('player-joined', sanitizedPlayerName);
    socket.emit('joined-lobby');
    
    // Si le jeu a déjà commencé, envoyer la question actuelle
    if (lobbies[sanitizedLobbyName].gameStarted && lobbies[sanitizedLobbyName].currentQuestion) {
      const question = getQuestion(lobbies[sanitizedLobbyName].currentQuestion);
      if (question) {
        socket.emit('question', question);
      }
    }
    
    console.log(`Joueur ${sanitizedPlayerName} a rejoint ${sanitizedLobbyName}`);
  });

  socket.on('start-game', () => {
    const lobby = lobbies[socket.lobby];
    if (!lobby || lobby.gmId !== socket.id) {
      socket.emit('error', 'Non autorisé');
      return;
    }
    
    if (lobby.players.length < 2) {
      socket.emit('error', 'Au moins 2 joueurs requis');
      return;
    }
    
    lobby.gameStarted = true;
    lobby.currentQuestion = 'question1';
    lobby.questionPath.push('question1');
    
    const question = getQuestion('question1');
    if (question) {
      io.in(socket.lobby).emit('game-start');
      io.in(socket.lobby).emit('question', question);
      console.log(`Partie démarrée dans ${socket.lobby}`);
    }
  });

  socket.on('choose-next-question', (nextQuestionId) => {
    const lobby = lobbies[socket.lobby];
    if (!lobby || lobby.gmId !== socket.id) {
      socket.emit('error', 'Non autorisé');
      return;
    }
    
    const sanitizedQuestionId = sanitizeInput(nextQuestionId);
    
    if (!isValidQuestionId(sanitizedQuestionId)) {
      socket.emit('error', 'ID de question invalide');
      return;
    }
    
    lobby.currentQuestion = sanitizedQuestionId;
    lobby.questionPath.push(sanitizedQuestionId);
    
    const question = getQuestion(sanitizedQuestionId);
    if (question) {
      io.in(socket.lobby).emit('question', question);
      io.to(lobby.gmId).emit('question-sent', sanitizedQuestionId);
    } else {
      io.in(socket.lobby).emit('game-over');
    }
  });

  socket.on('player-answer', ({ lobbyName, playerName, questionId, answer }) => {
    // Validation stricte
    const sanitizedLobbyName = sanitizeInput(lobbyName);
    const sanitizedPlayerName = sanitizeInput(playerName);
    const sanitizedQuestionId = sanitizeInput(questionId);
    const sanitizedAnswer = sanitizeInput(answer);
    
    if (!lobbies[sanitizedLobbyName] || 
        socket.lobby !== sanitizedLobbyName || 
        socket.playerName !== sanitizedPlayerName ||
        !['A', 'B', 'C', 'D'].includes(sanitizedAnswer)) {
      socket.emit('error', 'Réponse invalide');
      return;
    }
    
    if (!responses[sanitizedLobbyName][sanitizedPlayerName]) {
      responses[sanitizedLobbyName][sanitizedPlayerName] = {};
    }
    
    responses[sanitizedLobbyName][sanitizedPlayerName][sanitizedQuestionId] = sanitizedAnswer;
    io.to(lobbies[sanitizedLobbyName].gmId).emit('player-answer', { 
      playerName: sanitizedPlayerName, 
      answer: sanitizedAnswer, 
      questionId: sanitizedQuestionId 
    });

    // Calculer les statistiques
    const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
    for (const player in responses[sanitizedLobbyName]) {
      const playerAnswer = responses[sanitizedLobbyName][player][sanitizedQuestionId];
      if (playerAnswer && voteCounts[playerAnswer] !== undefined) {
        voteCounts[playerAnswer]++;
      }
    }
    
    io.in(sanitizedLobbyName).emit('vote-stats', voteCounts);
    
    if (lobbies[sanitizedLobbyName].currentQuestion === sanitizedQuestionId) {
      const currentQuestion = getQuestion(sanitizedQuestionId);
      if (currentQuestion && currentQuestion.nextQuestions) {
        io.to(lobbies[sanitizedLobbyName].gmId).emit('next-options', {
          questionId: sanitizedQuestionId,
          nextQuestions: currentQuestion.nextQuestions,
          voteCounts
        });
      }
    }
  });

  socket.on('end-game', () => {
    const lobby = lobbies[socket.lobby];
    if (!lobby || lobby.gmId !== socket.id) {
      socket.emit('error', 'Non autorisé');
      return;
    }
    
    io.in(socket.lobby).emit('game-over');
    console.log(`Partie terminée dans ${socket.lobby}`);
  });

  socket.on('request-csv', () => {
    const lobbyName = socket.lobby;
    const lobby = lobbies[lobbyName];
    
    if (!lobby || lobby.gmId !== socket.id) {
      socket.emit('error', 'Non autorisé');
      return;
    }
    
    const filename = generateSecureFilename(lobbyName);
    const filepath = path.join(__dirname, 'exports', filename);
    
    // Créer le dossier exports s'il n'existe pas
    const exportsDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { mode: 0o755 });
    }
    
    try {
      const questionIds = lobby.questionPath;
      const header = ['Prénom', ...questionIds];
      const rows = [header];
      
      for (const player in responses[lobbyName]) {
        const sanitizedPlayer = sanitizeInput(player);
        const row = [sanitizedPlayer, ...questionIds.map(q => responses[lobbyName][player][q] || '')];
        rows.push(row);
      }
      
      const csvContent = rows.map(r => r.map(cell => 
        `"${String(cell).replace(/"/g, '""')}"`
      ).join(',')).join('\n');
      
      fs.writeFileSync(filepath, csvContent, 'utf-8');
      
      // Autoriser l'accès à ce fichier
      fileAccess[filename] = {
        lobbyName: lobbyName,
        createdAt: Date.now(),
        socketId: socket.id
      };
      
      socket.emit('csv-ready', filename);
      console.log(`CSV généré: ${filename} pour ${lobbyName}`);
      
    } catch (error) {
      console.error('Erreur génération CSV:', error);
      socket.emit('error', 'Erreur lors de la génération du fichier');
    }
  });

  socket.on('disconnect', () => {
    console.log(`Déconnexion: ${socket.id}`);
    
    // Nettoyer les données du joueur déconnecté
    if (socket.lobby && lobbies[socket.lobby]) {
      const lobby = lobbies[socket.lobby];
      
      if (lobby.gmId === socket.id) {
        // Le GM s'est déconnecté, nettoyer le lobby
        delete lobbies[socket.lobby];
        delete responses[socket.lobby];
        console.log(`Lobby supprimé: ${socket.lobby} (GM déconnecté)`);
      } else if (socket.playerName) {
        // Un joueur s'est déconnecté
        const index = lobby.players.indexOf(socket.playerName);
        if (index > -1) {
          lobby.players.splice(index, 1);
          io.to(lobby.gmId).emit('player-left', socket.playerName);
        }
      }
    }
  });
});

// Nettoyage périodique des anciens lobbies et fichiers
setInterval(() => {
  const now = Date.now();
  const maxAge = 4 * 60 * 60 * 1000; // 4 heures
  
  // Nettoyer les lobbies anciens
  for (const [lobbyName, lobby] of Object.entries(lobbies)) {
    if (now - lobby.createdAt > maxAge) {
      delete lobbies[lobbyName];
      delete responses[lobbyName];
      console.log(`Lobby expiré supprimé: ${lobbyName}`);
    }
  }
  
  // Nettoyer les anciens fichiers
  const exportsDir = path.join(__dirname, 'exports');
  if (fs.existsSync(exportsDir)) {
    fs.readdir(exportsDir, (err, files) => {
      if (err) return;
      
      files.forEach(file => {
        const filePath = path.join(exportsDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          
          if (now - stats.mtime.getTime() > maxAge) {
            fs.unlink(filePath, (err) => {
              if (!err) {
                console.log(`Fichier expiré supprimé: ${file}`);
                delete fileAccess[file];
              }
            });
          }
        });
      });
    });
  }
}, 60 * 60 * 1000); // Toutes les heures

// Gestion d'erreur globale
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).send('Erreur interne du serveur');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur sécurisé lancé sur le port ${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
});