const socket = io();
let currentMode = 'home';
let currentLobby = '';
let playerName = '';
let playerCount = 0;

// === FONCTIONS UTILITAIRES ===

// Navigation entre les écrans
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// Générer QR Code
function generateQRCode(text) {
  const qrCodeElement = document.getElementById('qrcode');
  qrCodeElement.innerHTML = ''; // Clear existing QR code
  
  try {
    // Méthode 1 : Utiliser QRious si disponible
    if (typeof QRious !== 'undefined') {
      const canvas = document.createElement('canvas');
      const qr = new QRious({
        element: canvas,
        value: text,
        size: 200,
        foreground: '#007bff',
        background: '#ffffff'
      });
      
      // Ajouter le style au canvas
      canvas.style.border = '2px solid #007bff';
      canvas.style.borderRadius = '8px';
      canvas.style.padding = '10px';
      canvas.style.background = 'white';
      
      qrCodeElement.appendChild(canvas);
      console.log('QR Code généré avec QRious pour:', text);
      return;
    }
  } catch (e) {
    console.error('Erreur lors de la génération du QR Code:', e);
  }
}

// Mettre à jour le compteur de joueurs et le bouton de démarrage
function updatePlayerCount() {
  document.getElementById('playerCount').textContent = playerCount;
  const startButton = document.getElementById('startGameBtn');
  const warning = document.getElementById('minimumWarning');
  
  if (playerCount >= 2) {
    startButton.disabled = false;
    warning.style.display = 'none';
  } else {
    startButton.disabled = true;
    warning.style.display = 'inline';
  }
}

// === INITIALISATION ===
document.addEventListener('DOMContentLoaded', function() {
  initializeEventListeners();
  checkUrlParameters();
});

function initializeEventListeners() {
  // Mode selection
  document.getElementById('gm-mode-btn').onclick = () => {
    currentMode = 'gm';
    showScreen('gm-screen');
  };

  document.getElementById('player-mode-btn').onclick = () => {
    currentMode = 'player';
    showScreen('player-screen');
    // Auto-remplir le code du lobby depuis l'URL si présent
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyFromUrl = urlParams.get('lobby');
    if (lobbyFromUrl) {
      document.getElementById('lobbyCodeInput').value = lobbyFromUrl;
    }
  };

  // === ÉVÉNEMENTS MAITRE DU JEU ===
  document.getElementById('createLobbyBtn').onclick = createLobby;
  document.getElementById('copyLinkBtn').onclick = copyPlayerLink;
  document.getElementById('startGameBtn').onclick = startGame;
  document.getElementById('endGameBtn').onclick = endGame;
  document.getElementById('generateCsvBtn').onclick = generateCsv;

  // === ÉVÉNEMENTS JOUEUR ===
  document.getElementById('joinLobbyBtn').onclick = joinLobby;
  document.getElementById('backToHomeBtn').onclick = backToHome;
}

function checkUrlParameters() {
  const urlParams = new URLSearchParams(window.location.search);
  const lobbyFromUrl = urlParams.get('lobby');
  if (lobbyFromUrl) {
    // Basculer automatiquement en mode joueur si un lobby est dans l'URL
    currentMode = 'player';
    showScreen('player-screen');
    document.getElementById('lobbyCodeInput').value = lobbyFromUrl;
  }
}

// === FONCTIONS MAITRE DU JEU ===

function createLobby() {
  const lobbyName = document.getElementById('lobbyNameInput').value.trim();
  if (lobbyName) {
    currentLobby = lobbyName;
    socket.emit('create-lobby', lobbyName);
  } else {
    alert('Veuillez entrer un nom de lobby');
  }
}

function copyPlayerLink() {
  const link = document.getElementById('playerLink').textContent;
  navigator.clipboard.writeText(link).then(() => {
    alert('Lien copié dans le presse-papiers !');
  }).catch(() => {
    // Fallback pour les navigateurs plus anciens
    const textArea = document.createElement('textarea');
    textArea.value = link;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    alert('Lien copié !');
  });
}

function startGame() {
  if (playerCount < 2) {
    alert('Au moins 2 joueurs sont nécessaires pour démarrer la partie !');
    return;
  }
  
  socket.emit('start-game');
  document.getElementById('game-control').style.display = 'block';
  document.getElementById('startGameBtn').style.display = 'none';
}

function endGame() {
  if (confirm('Êtes-vous sûr de vouloir terminer la partie ?')) {
    socket.emit('end-game');
  }
}

function generateCsv() {
  socket.emit('request-csv');
}

// Fonction chooseNextQuestion corrigée avec plus de logs pour le debug
function chooseNextQuestion(questionId) {
  console.log('chooseNextQuestion appelée avec:', questionId);
  
  if (!questionId) {
    console.error('Erreur: questionId est vide ou undefined');
    alert('Erreur: ID de question invalide');
    return;
  }
  
  // Émettre l'événement au serveur
  socket.emit('choose-next-question', questionId);
  
  // Masquer les options de sélection
  const nextOptionsDiv = document.getElementById('nextQuestionOptions');
  if (nextOptionsDiv) {
    nextOptionsDiv.style.display = 'none';
  }
  
  // Vider le log des réponses précédentes
  const answersLog = document.getElementById('answersLog');
  if (answersLog) {
    answersLog.innerHTML = '';
  }
  
  // Effacer les stats précédentes
  const voteStats = document.getElementById('voteStats');
  if (voteStats) {
    voteStats.innerHTML = '';
  }
  
  console.log(`Question ${questionId} sélectionnée, événement envoyé au serveur`);
}


function displayPlayerJoined(name) {
  const playersDiv = document.getElementById('playersList');
  const playerEl = document.createElement('div');
  playerEl.className = 'player-item';
  playerEl.textContent = `👤 ${name}`;
  playerEl.id = `player-${name}`;
  playersDiv.appendChild(playerEl);
  
  playerCount++;
  updatePlayerCount();
}

function displayPlayerLeft(name) {
  const playerEl = document.getElementById(`player-${name}`);
  if (playerEl) {
    playerEl.remove();
    playerCount--;
    updatePlayerCount();
  }
}

function displayPlayerAnswer(playerName, answer, questionId) {
  const log = document.getElementById('answersLog');
  const answerEl = document.createElement('div');
  answerEl.textContent = `${playerName} → ${answer}`;
  answerEl.style.padding = '2px 0';
  answerEl.style.borderBottom = '1px solid #f0f0f0';
  log.appendChild(answerEl);
  log.scrollTop = log.scrollHeight;
}

function displayVoteStats(voteCounts) {
  const statsDiv = document.getElementById('voteStats');
  statsDiv.innerHTML = '<h4>📊 Statistiques des votes :</h4>';
  
  const total = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
  
  for (const [letter, count] of Object.entries(voteCounts)) {
    if (count > 0) {
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      const bar = document.createElement('div');
      bar.className = 'vote-line';
      bar.textContent = `${letter}: ${'█'.repeat(count)} (${count} - ${percentage}%)`;
      statsDiv.appendChild(bar);
    }
  }
}

// Modification de la fonction displayNextOptions pour corriger le problème des boutons
function displayNextOptions(questionId, nextQuestions, voteCounts) {
  const optionsDiv = document.getElementById('nextQuestionOptions');
  const container = document.getElementById('nextOptionsContainer');
  
  container.innerHTML = '';
  optionsDiv.style.display = 'block';
  
  for (const [answer, nextQuestionId] of Object.entries(nextQuestions)) {
    const voteCount = voteCounts[answer] || 0;
    const option = document.createElement('div');
    option.className = 'next-option';
    
    // Créer le bouton séparément pour attacher l'événement correctement
    const button = document.createElement('button');
    button.className = 'button';
    button.textContent = '📍 Aller à cette question';
    
    // Attacher l'événement avec addEventListener au lieu d'onclick inline
    button.addEventListener('click', function() {
      chooseNextQuestion(nextQuestionId);
    });
    
    option.innerHTML = `
      <strong>Réponse ${answer}</strong> (${voteCount} vote${voteCount > 1 ? 's' : ''})<br>
    `;
    
    option.appendChild(button);
    container.appendChild(option);
  }
}

// Debug: Ajout d'une fonction pour tester la connexion
function testConnection() {
  console.log('Test de connexion socket.io...');
  console.log('Socket connecté:', socket.connected);
  console.log('Socket ID:', socket.id);
  console.log('Mode actuel:', currentMode);
  console.log('Lobby actuel:', currentLobby);
}
// === FONCTIONS JOUEUR ===

function joinLobby() {
  const name = document.getElementById('playerNameInput').value.trim();
  const lobby = document.getElementById('lobbyCodeInput').value.trim();
  
  if (!name) {
    alert('Veuillez entrer votre prénom');
    return;
  }
  
  if (!lobby) {
    alert('Veuillez entrer le code du lobby');
    return;
  }
  
  playerName = name;
  currentLobby = lobby;
  socket.emit('join-lobby', { playerName: name, lobbyName: lobby });
}

function backToHome() {
  showScreen('home-screen');
  currentMode = 'home';
  
  // Réinitialiser les états
  document.getElementById('player-join').style.display = 'block';
  document.getElementById('player-waiting').style.display = 'none';
  document.getElementById('player-game').style.display = 'none';
  document.getElementById('player-game-over').style.display = 'none';
  
  // Vider les champs
  document.getElementById('playerNameInput').value = '';
  document.getElementById('lobbyCodeInput').value = '';
}

function displayQuestion(questionData) {
  document.getElementById('questionTitle').textContent = questionData.question;
  
  // Afficher le contexte s'il existe
  const contextDiv = document.getElementById('questionContext');
  if (questionData.context) {
    contextDiv.textContent = questionData.context;
    contextDiv.style.display = 'block';
  } else {
    contextDiv.style.display = 'none';
  }
  
  const choicesDiv = document.getElementById('questionChoices');
  choicesDiv.innerHTML = '';
  document.getElementById('playerStatus').textContent = '';
  document.getElementById('playerVoteStats').innerHTML = '';
  
  questionData.choices.forEach((choice, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, D
    const btn = document.createElement('button');
    btn.className = 'button choice-button';
    btn.textContent = `${letter}. ${choice}`;
    btn.onclick = () => submitPlayerAnswer(questionData.id, letter);
    choicesDiv.appendChild(btn);
  });
}

function submitPlayerAnswer(questionId, answer) {
  socket.emit('player-answer', {
    lobbyName: currentLobby,
    playerName: playerName,
    questionId: questionId,
    answer: answer
  });
  
  // Désactiver tous les boutons
  document.querySelectorAll('.choice-button').forEach(b => {
    b.disabled = true;
    b.style.opacity = '0.6';
  });
  
  document.getElementById('playerStatus').textContent = '✅ Réponse enregistrée ! En attente des autres...';
}

function displayPlayerVoteStats(voteCounts) {
  const statsDiv = document.getElementById('playerVoteStats');
  statsDiv.innerHTML = '<h4>📊 Votes en temps réel :</h4>';
  
  const total = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
  
  for (const [letter, count] of Object.entries(voteCounts)) {
    if (count > 0) {
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      const bar = document.createElement('div');
      bar.className = 'vote-line';
      bar.textContent = `${letter}: ${'█'.repeat(count)} (${count} - ${percentage}%)`;
      statsDiv.appendChild(bar);
    }
  }
}

// === ÉVÉNEMENTS SOCKET ===

// Événements GM
socket.on('lobby-created', (lobbyName) => {
  document.getElementById('lobby-creation').style.display = 'none';
  document.getElementById('lobby-management').style.display = 'block';
  const playerLink = `${window.location.origin}?lobby=${lobbyName}`;
  document.getElementById('playerLink').textContent = playerLink;
  
  // Générer le QR Code
  generateQRCode(playerLink);
  
  // Réinitialiser le compteur de joueurs
  playerCount = 0;
  updatePlayerCount();
});

socket.on('player-joined', (name) => {
  displayPlayerJoined(name);
});

socket.on('player-left', (name) => {
  displayPlayerLeft(name);
});

socket.on('player-answer', ({ playerName, answer, questionId }) => {
  displayPlayerAnswer(playerName, answer, questionId);
});

socket.on('vote-stats', (voteCounts) => {
  if (currentMode === 'gm') {
    displayVoteStats(voteCounts);
  } else if (currentMode === 'player') {
    displayPlayerVoteStats(voteCounts);
  }
});

socket.on('next-options', ({ questionId, nextQuestions, voteCounts }) => {
  displayNextOptions(questionId, nextQuestions, voteCounts);
});

// Ajout d'un listener pour l'événement question-sent du serveur pour confirmer
socket.on('question-sent', (questionId) => {
  console.log(`✅ Confirmation: Question ${questionId} envoyée aux joueurs`);
  
  // Optionnel: afficher une notification temporaire au GM
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #28a745;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 1000;
    font-weight: bold;
  `;
  notification.textContent = `Question ${questionId} envoyée !`;
  document.body.appendChild(notification);
  
  // Supprimer la notification après 3 secondes
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 3000);
});

socket.on('csv-ready', (filename) => {
  const link = document.getElementById('csvDownloadLink');
  link.href = '/exports/' + filename;
  link.download = filename;
  link.style.display = 'inline-block';
  link.textContent = `📄 Télécharger ${filename}`;
});

// Événements Joueur
socket.on('joined-lobby', () => {
  document.getElementById('player-join').style.display = 'none';
  document.getElementById('player-waiting').style.display = 'block';
});

socket.on('game-start', () => {
  document.getElementById('player-waiting').style.display = 'none';
  document.getElementById('player-game').style.display = 'block';
});

socket.on('question', (questionData) => {
  displayQuestion(questionData);
});

socket.on('game-over', () => {
  if (currentMode === 'player') {
    document.getElementById('player-game').style.display = 'none';
    document.getElementById('player-game-over').style.display = 'block';
  } else if (currentMode === 'gm') {
    alert('🎉 Partie terminée !');
    // Optionnel : réinitialiser l'interface GM
  }
});

// Événements communs
// Ajout d'un gestionnaire d'erreur spécifique pour les problèmes de questions
socket.on('error', (message) => {
  console.error('Erreur reçue du serveur:', message);
  alert('❌ Erreur : ' + message);
  
  // Si l'erreur concerne une question, réafficher les options
  if (message.includes('question') && currentMode === 'gm') {
    const nextOptionsDiv = document.getElementById('nextQuestionOptions');
    if (nextOptionsDiv && nextOptionsDiv.style.display === 'none') {
      nextOptionsDiv.style.display = 'block';
    }
  }
});

socket.on('connect', () => {
  console.log('✅ Connecté au serveur');
});

socket.on('disconnect', () => {
  console.log('❌ Déconnecté du serveur');
});

// === FONCTIONS D'AIDE ===

// Fonction pour déboguer (optionnelle)
function debugLog(message) {
        if (window.location.hostname === 'localhost') {
        setTimeout(testConnection, 1000);
        }
}