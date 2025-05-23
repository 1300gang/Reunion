
const socket = io();
const bodyId = document.body.id;

if (bodyId === 'gm') {
  const lobbyNameInput = document.getElementById('lobbyName');
  const createBtn = document.getElementById('createLobbyBtn');
  const linkContainer = document.getElementById('linkContainer');
  const lobbyLink = document.getElementById('lobbyLink');
  const startBtn = document.getElementById('startGameBtn');
  const nextBtn = document.getElementById('nextQuestionBtn');
  const playersDiv = document.getElementById('players');
  const answersDiv = document.getElementById('answers');
  const csvBtn = document.getElementById('generateCsvBtn');
  const csvLink = document.getElementById('csvLink');

  createBtn.onclick = () => {
    const lobbyName = lobbyNameInput.value.trim();
    socket.emit('create-lobby', lobbyName);
  };

  socket.on('lobby-created', (lobby) => {
    const url = window.location.origin + "/player.html?lobby=" + lobby;
  lobbyLink.value = url; // met le lien dans le champ input

  const copyBtn = document.getElementById('copyBtn');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(url).then(() => {
      alert("Lien copié dans le presse-papier !");
    }).catch(() => {
      console.warn("Impossible de copier automatiquement.");
    });
};

linkContainer.style.display = 'block';
  });

  startBtn.onclick = () => {
    socket.emit('start-game');
  };

  nextBtn.onclick = () => {
    socket.emit('broadcast-next-question');
    answersDiv.innerHTML = '';
  };

  socket.on('player-joined', (name) => {
    const p = document.createElement('p');
    p.textContent = name;
    playersDiv.appendChild(p);
  });

  socket.on('player-answer', ({ playerName, answer, answerText, questionText, index }) => {
    const p = document.createElement('p');
    p.textContent = `Q${index}: ${questionText} — ${playerName} a répondu ${answer} : ${answerText}`;
    answersDiv.appendChild(p);
  });

  csvBtn.onclick = () => {
    socket.emit('request-csv');
  };

  socket.on('csv-ready', (filename) => {
    csvLink.href = '/exports/' + filename;
    csvLink.style.display = 'inline';
  });

} else if (bodyId === 'player') {
  const nameInput = document.getElementById('playerName');
  const joinBtn = document.getElementById('joinLobbyBtn');
  const waitDiv = document.getElementById('waiting');
  const urlParams = new URLSearchParams(window.location.search);
  const lobby = urlParams.get('lobby');

  joinBtn.onclick = () => {
    const name = nameInput.value.trim();
    localStorage.setItem('playerName', name);
    localStorage.setItem('lobby', lobby);
    socket.emit('join-lobby', { playerName: name, lobbyName: lobby });
  };

  socket.on('joined-lobby', () => {
    waitDiv.style.display = 'block';
  });

  socket.on('game-start', () => {
    window.location.href = 'partie.html';
  });

} else if (bodyId === 'partie') {
  const lobby = localStorage.getItem('lobby');
  const playerName = localStorage.getItem('playerName');
  const questionText = document.getElementById('questionText');
  const choicesDiv = document.getElementById('choices');
  const statusMessage = document.getElementById('statusMessage');
  const voteBar = document.getElementById('voteBar');

  socket.emit('rejoin-lobby', { lobbyName: lobby, playerName });

  socket.on('question', (data) => {
    questionText.textContent = data.question;
    choicesDiv.innerHTML = '';
    voteBar.innerHTML = '';
    statusMessage.textContent = '';
    data.choices.forEach((choice, i) => {
      const letter = String.fromCharCode(65 + i);
      const btn = document.createElement('button');
      btn.textContent = `${letter}. ${choice}`;
      btn.onclick = () => {
        socket.emit('player-answer', { lobbyName: lobby, playerName, questionIndex: data.index, answer: letter });
        document.querySelectorAll('#choices button').forEach(b => b.disabled = true);
        statusMessage.textContent = "Réponse enregistrée. En attente des autres...";
      };
      choicesDiv.appendChild(btn);
    });
  });

  socket.on('vote-stats', (voteCounts) => {
    voteBar.innerHTML = '';
    for (const [letter, count] of Object.entries(voteCounts)) {
      const bar = document.createElement('div');
      bar.textContent = `${letter}: ${'█'.repeat(count)} (${count})`;
      voteBar.appendChild(bar);
    }
  });

  socket.on('game-over', () => {
    questionText.textContent = 'Partie terminée';
    choicesDiv.innerHTML = '';
    statusMessage.textContent = '';
    voteBar.innerHTML = '';
  });
}
